'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { AQ_HERO_BTN_PRIMARY } from '@/components/aquaculture/AquacultureUi'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { AskBrainButton } from '@/components/brain/AskBrainButton'
import { Plus, Edit2, Trash2, Mail, Phone, X, User, Briefcase, DollarSign, MapPin, Building2, AlertTriangle, RefreshCw, Search, Filter, BookOpen, Grid3x3, List, Droplets } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { usePageMeta } from '@/hooks/usePageMeta'
import { useT } from '@/lib/i18n'
import { useErpCommonT } from '@/lib/moduleI18n/erpCommon'
import { useEmployeesT } from '@/lib/moduleI18n/employees'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { formatDateLong } from '@/utils/date'
import api, { getApiBaseUrl, getBackendOrigin } from '@/lib/api'
import { ReferenceCodePicker } from '@/components/ReferenceCodePicker'

interface Employee {
  id: number
  employee_number?: string
  employee_code?: string
  first_name: string
  last_name: string
  email?: string
  phone?: string
  position?: string
  job_title?: string
  department?: string
  hire_date?: string
  salary?: number
  current_balance?: string | number
  opening_balance?: string | number
  opening_balance_date?: string | null
  is_active: boolean
  /** Primary work site (ops / reporting) */
  home_station_id?: number | null
  home_station_name?: string | null
  work_site_label?: string | null
  /** Primary aquaculture pond (pond P&L / payroll labor attribution) */
  home_aquaculture_pond_id?: number | null
  home_aquaculture_pond_name?: string | null
  aquaculture_labor_scope?: 'not_applicable' | 'assigned_pond' | 'all_ponds_equal'
  aquaculture_labor_scope_label?: string
}

type AquacultureLaborScope = 'not_applicable' | 'assigned_pond' | 'all_ponds_equal'

interface StationOption {
  id: number
  station_name: string
  is_active?: boolean
  operates_fuel_retail?: boolean
  default_aquaculture_pond_id?: number | null
}

function parseLaborScope(raw: string | undefined | null): AquacultureLaborScope {
  if (raw === 'all_ponds_equal' || raw === 'assigned_pond' || raw === 'not_applicable') {
    return raw
  }
  return 'not_applicable'
}


function employeeWorkSiteDisplay(employee: Employee): string {
  const fromApi = (employee.work_site_label || '').trim()
  if (fromApi) return fromApi
  if (employee.home_station_id != null && employee.home_station_id > 0) {
    const named = (employee.home_station_name || '').trim()
    if (named) return named
    return `Site #${employee.home_station_id}`
  }
  if (employee.aquaculture_labor_scope === 'all_ponds_equal') {
    return 'All ponds (equal share)'
  }
  if (employee.aquaculture_labor_scope === 'assigned_pond') {
    const pond = (employee.home_aquaculture_pond_name || '').trim()
    if (pond) return pond
    if (employee.home_aquaculture_pond_id) return `Pond #${employee.home_aquaculture_pond_id}`
    return 'Pond — not set'
  }
  return '—'
}

function employeePondWagesDisplay(employee: Employee): string {
  if (employee.aquaculture_labor_scope === 'not_applicable') return 'Not set'
  if (employee.aquaculture_labor_scope === 'all_ponds_equal') return 'All ponds (equal share)'
  const pond = (employee.home_aquaculture_pond_name || '').trim()
  if (pond) return pond
  if (employee.home_aquaculture_pond_id) return `Pond #${employee.home_aquaculture_pond_id}`
  return 'Not set'
}

function stationSelected(stationId: string | number): boolean {
  return stationId !== '' && stationId != null
}

type WorkEntityFormSlice = {
  home_station_id: string | number
  home_aquaculture_pond_id: string | number
  aquaculture_labor_scope: AquacultureLaborScope
}

function workEntityKeyFromForm(form: WorkEntityFormSlice): string {
  if (stationSelected(form.home_station_id)) {
    return `station:${form.home_station_id}`
  }
  if (form.aquaculture_labor_scope === 'all_ponds_equal') {
    return 'all_ponds'
  }
  if (
    form.aquaculture_labor_scope === 'assigned_pond' &&
    form.home_aquaculture_pond_id !== '' &&
    form.home_aquaculture_pond_id != null
  ) {
    return `pond:${form.home_aquaculture_pond_id}`
  }
  return 'head_office'
}

function applyWorkEntityKey(key: string): WorkEntityFormSlice {
  if (key.startsWith('station:')) {
    return {
      home_station_id: key.slice('station:'.length),
      aquaculture_labor_scope: 'not_applicable',
      home_aquaculture_pond_id: '',
    }
  }
  if (key.startsWith('pond:')) {
    return {
      home_station_id: '',
      aquaculture_labor_scope: 'assigned_pond',
      home_aquaculture_pond_id: key.slice('pond:'.length),
    }
  }
  if (key === 'all_ponds') {
    return {
      home_station_id: '',
      aquaculture_labor_scope: 'all_ponds_equal',
      home_aquaculture_pond_id: '',
    }
  }
  return {
    home_station_id: '',
    aquaculture_labor_scope: 'not_applicable',
    home_aquaculture_pond_id: '',
  }
}

interface PondOption {
  id: number
  name: string
  is_active?: boolean
}

export default function EmployeesPage() {
  const router = useRouter()
  const toast = useToast()
  const pageMeta = usePageMeta()
  const { t } = useT()
  const tr = useErpCommonT()
  const et = useEmployeesT()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [currencySymbol, setCurrencySymbol] = useState<string>('৳') // Default to BDT
  const [searchTerm, setSearchTerm] = useState('')
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('all')
  const [viewMode, setViewMode] = useState<'card' | 'list'>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('employees_view_mode')
      if (v === 'card' || v === 'list') return v
    }
    return 'card'
  })
  const [empCodePickerNonce, setEmpCodePickerNonce] = useState(0)
  const [stations, setStations] = useState<StationOption[]>([])
  const [aquacultureEnabled, setAquacultureEnabled] = useState(false)
  const [aquaculturePonds, setAquaculturePonds] = useState<PondOption[]>([])
  const [formData, setFormData] = useState({
    employee_code: '',
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    hire_date: '',
    job_title: '',
    department: '',
    salary: '',
    opening_balance: 0,
    opening_balance_date: new Date().toISOString().split('T')[0],
    is_active: true,
    home_station_id: '' as string | number,
    home_aquaculture_pond_id: '' as string | number,
    aquaculture_labor_scope: 'not_applicable' as AquacultureLaborScope,
  })

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    fetchCompanyCurrency()
    fetchStations()
    fetchAquacultureContext()
    fetchEmployees()
  }, [router])

  const fetchAquacultureContext = async () => {
    try {
      const res = await api.get<{ aquaculture_enabled?: boolean }>('/companies/current/', { timeout: 8000 })
      const enabled = Boolean(res.data?.aquaculture_enabled)
      setAquacultureEnabled(enabled)
      if (!enabled) {
        setAquaculturePonds([])
        return
      }
      const pr = await api.get<unknown[]>('/aquaculture/ponds/', { timeout: 8000 })
      const rows = Array.isArray(pr.data) ? pr.data : []
      const parsed: PondOption[] = []
      for (const r of rows) {
        const o = r as { id?: number; name?: string; is_active?: boolean }
        if (typeof o.id !== 'number') continue
        parsed.push({
          id: o.id,
          name: (o.name || `Pond ${o.id}`).trim() || `Pond ${o.id}`,
          is_active: o.is_active,
        })
      }
      setAquaculturePonds(parsed)
    } catch {
      setAquacultureEnabled(false)
      setAquaculturePonds([])
    }
  }

  const fetchStations = async () => {
    try {
      const res = await api.get<unknown[]>('/stations/', { timeout: 8000 })
      const rows = Array.isArray(res.data) ? res.data : []
      const parsed: StationOption[] = []
      for (const r of rows) {
        const o = r as {
          id?: number
          station_name?: string
          is_active?: boolean
          operates_fuel_retail?: boolean
          default_aquaculture_pond_id?: number | null
        }
        if (typeof o.id !== 'number') continue
        if (o.is_active === false) continue
        parsed.push({
          id: o.id,
          station_name: o.station_name || `Site #${o.id}`,
          is_active: o.is_active,
          operates_fuel_retail: o.operates_fuel_retail,
          default_aquaculture_pond_id: o.default_aquaculture_pond_id ?? null,
        })
      }
      setStations(parsed)
    } catch {
      setStations([])
    }
  }

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

  const fetchEmployees = async () => {
    setLoading(true)
    setError(null)
    try {
      const token = localStorage.getItem('access_token')
      if (!token) {
        toast.error('No authentication token found')
        setLoading(false)
        return
      }
      
      const response = await api.get('/employees/', { timeout: 15000 })

      if (response.status === 401) {
        localStorage.removeItem('access_token')
        router.push('/login')
        toast.error('Session expired. Please login again.')
        return
      }

      const data = response.data
      if (Array.isArray(data)) {
        setEmployees(data)
        setError(null)
      } else {
        const errorMsg = 'Failed to load employees: unexpected response'
        setError(errorMsg)
        toast.error(errorMsg)
      }
    } catch (error) {
      console.error('Error fetching employees:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      let userMessage = 'Error connecting to server'
      
      if (error instanceof TypeError && error.message.includes('fetch')) {
        userMessage = `Cannot connect to backend server. Please ensure the backend is running on ${getBackendOrigin()}`
      } else if (errorMessage.includes('timeout')) {
        userMessage = 'Request timed out. The backend server may be slow or unresponsive.'
      } else if (errorMessage.includes('CORS')) {
        userMessage = 'CORS error detected. Please check backend CORS configuration.'
      } else {
        userMessage = `Error connecting to server: ${errorMessage}`
      }
      setError(userMessage)
      toast.error(userMessage)
    } finally {
      setLoading(false)
    }
  }

  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      const matchesSearch =
        !searchTerm ||
        `${emp.first_name} ${emp.last_name}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (emp.employee_number || emp.employee_code || '')
          .toLowerCase()
          .includes(searchTerm.toLowerCase()) ||
        (emp.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (emp.phone || '').includes(searchTerm) ||
        (emp.home_station_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (emp.home_aquaculture_pond_name || '').toLowerCase().includes(searchTerm.toLowerCase())

      const matchesFilter =
        filterActive === 'all' ||
        (filterActive === 'active' && emp.is_active) ||
        (filterActive === 'inactive' && !emp.is_active)

      return matchesSearch && matchesFilter
    })
  }, [employees, searchTerm, filterActive])

  const resetForm = () => {
    setFormData({
      employee_code: '',
      first_name: '',
      last_name: '',
      email: '',
      phone: '',
      hire_date: '',
      job_title: '',
      department: '',
      salary: '',
      opening_balance: 0,
      opening_balance_date: new Date().toISOString().split('T')[0],
      is_active: true,
      home_station_id: '',
      home_aquaculture_pond_id: '',
      aquaculture_labor_scope: 'not_applicable',
    })
    setEditingId(null)
  }

  const workEntityKey = workEntityKeyFromForm(formData)
  const isSharedAcrossAllPonds = workEntityKey === 'all_ponds'
  const workSiteIsFuelOrShop = workEntityKey.startsWith('station:')
  const workSiteIsSinglePond = workEntityKey.startsWith('pond:')

  const buildEmployeeSaveBody = (): Record<string, unknown> => {
    const code = formData.employee_code.trim()
    const body: Record<string, unknown> = {
      first_name: formData.first_name,
      last_name: formData.last_name,
      email: formData.email || null,
      phone: formData.phone || null,
      hire_date: formData.hire_date || null,
      job_title: formData.job_title || null,
      department: formData.department || null,
      salary: formData.salary ? parseFloat(formData.salary) : null,
      opening_balance: formData.opening_balance,
      opening_balance_date: formData.opening_balance_date || null,
      is_active: formData.is_active,
      home_station_id:
        formData.home_station_id !== '' && formData.home_station_id != null
          ? parseInt(String(formData.home_station_id), 10)
          : null,
    }
    if (code) {
      body.employee_code = code
    }
    if (aquacultureEnabled) {
      body.aquaculture_labor_scope = formData.aquaculture_labor_scope
      body.home_aquaculture_pond_id =
        formData.aquaculture_labor_scope === 'assigned_pond' &&
        formData.home_aquaculture_pond_id !== '' &&
        formData.home_aquaculture_pond_id != null
          ? parseInt(String(formData.home_aquaculture_pond_id), 10)
          : null
    }
    return body
  }

  const employeeSaveErrorDetail = (error: unknown): string => {
    if (error && typeof error === 'object' && 'response' in error) {
      const data = (error as { response?: { data?: { detail?: unknown }; status?: number } }).response?.data
      const detail = data?.detail
      if (typeof detail === 'string' && detail.trim()) return detail
      if (Array.isArray(detail) && detail.length > 0) return String(detail[0])
      const status = (error as { response?: { status?: number } }).response?.status
      if (status === 401) return 'Authentication required. Please log in again.'
    }
    return 'Request failed'
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.first_name || !formData.last_name) {
      toast.error(tr('fillRequiredFields'))
      return
    }

    try {
      await api.post('/employees/', buildEmployeeSaveBody(), { timeout: 15000 })
      toast.success(et('employeeCreated'))
      setShowModal(false)
      resetForm()
      fetchEmployees()
    } catch (error) {
      console.error('Error creating employee:', error)
      toast.error(employeeSaveErrorDetail(error))
    }
  }

  const handleEdit = (employee: Employee) => {
    setEditingId(employee.id)
    setFormData({
      employee_code: employee.employee_number || employee.employee_code || '',
      first_name: employee.first_name,
      last_name: employee.last_name,
      email: employee.email || '',
      phone: employee.phone || '',
      hire_date: employee.hire_date ? employee.hire_date.split('T')[0] : '',
      job_title: employee.position || employee.job_title || '',
      department: employee.department || '',
      salary: employee.salary ? employee.salary.toString() : '',
      opening_balance: Number(employee.opening_balance ?? employee.current_balance ?? 0),
      opening_balance_date: employee.opening_balance_date
        ? employee.opening_balance_date.split('T')[0]
        : new Date().toISOString().split('T')[0],
      is_active: employee.is_active,
      home_station_id:
        employee.home_station_id != null && employee.home_station_id > 0
          ? String(employee.home_station_id)
          : '',
      home_aquaculture_pond_id:
        employee.home_aquaculture_pond_id != null && employee.home_aquaculture_pond_id > 0
          ? String(employee.home_aquaculture_pond_id)
          : '',
      aquaculture_labor_scope: parseLaborScope(employee.aquaculture_labor_scope),
    })
    setShowModal(true)
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId) return

    try {
      await api.put(`/employees/${editingId}/`, buildEmployeeSaveBody(), { timeout: 15000 })
      toast.success(et('employeeUpdated'))
      setShowModal(false)
      resetForm()
      fetchEmployees()
    } catch (error) {
      console.error('Error updating employee:', error)
      toast.error(employeeSaveErrorDetail(error))
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm(tr('confirmDeleteEmployee'))) return

    try {
      await api.delete(`/employees/${id}/`, { timeout: 15000 })
      toast.success(et('employeeDeleted'))
      fetchEmployees()
    } catch (error) {
      console.error('Error deleting employee:', error)
      toast.error(employeeSaveErrorDetail(error))
    }
  }

  if (loading) {
    return (
      <CompanyProvider>
        <PageLayout>
          <div className="flex min-h-[50vh] items-center justify-center p-6">
            <div className="erp-loading-spinner h-12 w-12"></div>
          </div>
        </PageLayout>
      </CompanyProvider>
    )
  }

  return (
    <CompanyProvider>
      <PageLayout>
        <div className="app-scroll-pad">
          <ErpPageShell
            flush
            showBackLink={false}
            title={pageMeta.title}
            titleIcon={User}
            description={pageMeta.description}
            maxWidthClass="max-w-[1600px]"
            contentClassName="mt-4"
            actions={
              <button
                type="button"
                onClick={() => {
                  resetForm()
                  setEmpCodePickerNonce((n) => n + 1)
                  setShowModal(true)
                }}
                className={AQ_HERO_BTN_PRIMARY}
              >
                <Plus className="h-4 w-4" aria-hidden />
                <span>{et('newEmployee')}</span>
              </button>
            }
          >
            {error ? (
              <div className="bg-destructive/5 border border-destructive/25 rounded-lg p-6 text-center">
                <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
                <h3 className="text-xl font-bold text-destructive mb-2">Error Loading Employees</h3>
                <p className="text-destructive mb-4">{error}</p>
                <button
                  onClick={fetchEmployees}
                  className="inline-flex items-center space-x-2 px-4 py-2 bg-destructive text-white rounded-lg hover:bg-destructive/90 transition-colors"
                >
                  <RefreshCw className="h-5 w-5" />
                  <span>Retry</span>
                </button>
              </div>
            ) : (
              <>
                {/* Search and Filter Bar */}
                <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-col md:flex-row gap-4 flex-1 min-w-0">
                      <div className="flex-1 relative min-w-0">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground/70" />
                        <input
                          type="text"
                          placeholder={et('searchEmployees')}
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="w-full pl-10 pr-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                        />
                      </div>
                      <div className="flex items-center space-x-2 shrink-0">
                        <Filter className="h-5 w-5 text-muted-foreground/70" />
                        <select
                          value={filterActive}
                          onChange={(e) => setFilterActive(e.target.value as 'all' | 'active' | 'inactive')}
                          className="px-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                        >
                          <option value="all">{tr('allOnly', { entities: et('Employees') })}</option>
                          <option value="active">{tr('activeOnly')}</option>
                          <option value="inactive">{tr('inactiveOnly')}</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2 shrink-0">
                      <div className="flex items-center bg-muted rounded-lg p-1">
                        <button
                          type="button"
                          onClick={() => {
                            setViewMode('card')
                            localStorage.setItem('employees_view_mode', 'card')
                          }}
                          className={`p-2 rounded transition-colors ${
                            viewMode === 'card'
                              ? 'bg-primary text-white shadow-sm'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                          title="Card view"
                        >
                          <Grid3x3 className="h-5 w-5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setViewMode('list')
                            localStorage.setItem('employees_view_mode', 'list')
                          }}
                          className={`p-2 rounded transition-colors ${
                            viewMode === 'list'
                              ? 'bg-primary text-white shadow-sm'
                              : 'text-muted-foreground hover:text-foreground'
                          }`}
                          title="List view"
                        >
                          <List className="h-5 w-5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {filteredEmployees.length > 0 && (
                  <div className="mb-4 text-sm text-muted-foreground">
                    Showing {filteredEmployees.length} of {employees.length} employee
                    {employees.length !== 1 ? 's' : ''}
                  </div>
                )}

                {employees.length > 0 && filteredEmployees.length > 0 && viewMode === 'card' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredEmployees.map((employee) => (
                      <div
                        key={employee.id}
                        className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow border border-border overflow-hidden"
                      >
                        <div className="bg-gradient-to-r from-accent to-accent px-6 py-4 border-b border-border">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3 min-w-0">
                              <div className="h-12 w-12 shrink-0 rounded-full bg-primary flex items-center justify-center text-white font-bold text-lg">
                                {employee.first_name.charAt(0)}
                                {(employee.last_name || '').charAt(0)}
                              </div>
                              <div className="min-w-0">
                                <h3 className="text-lg font-semibold text-foreground truncate">
                                  {employee.first_name} {employee.last_name}
                                </h3>
                                <p className="text-sm text-muted-foreground font-mono truncate">
                                  {employee.employee_number || employee.employee_code}
                                </p>
                              </div>
                            </div>
                            <span
                              className={`shrink-0 px-3 py-1 text-xs font-semibold rounded-full ${
                                employee.is_active
                                  ? 'bg-success/15 text-success border border-success/25'
                                  : 'bg-destructive/10 text-destructive border border-destructive/25'
                              }`}
                            >
                              {employee.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                        </div>

                        <div className="p-6 space-y-3">
                          {(employee.position || employee.job_title) && (
                            <div className="flex items-center space-x-2 text-sm">
                              <Briefcase className="h-4 w-4 text-muted-foreground/70 shrink-0" />
                              <span className="text-muted-foreground">
                                <span className="font-medium text-foreground/85">Position:</span>{' '}
                                {employee.position || employee.job_title}
                              </span>
                            </div>
                          )}
                          {employee.department && (
                            <div className="flex items-center space-x-2 text-sm">
                              <MapPin className="h-4 w-4 text-muted-foreground/70 shrink-0" />
                              <span className="text-muted-foreground">
                                <span className="font-medium text-foreground/85">Department:</span>{' '}
                                {employee.department}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center space-x-2 text-sm">
                            <Building2 className="h-4 w-4 text-amber-600/90 shrink-0" />
                            <span className="text-muted-foreground">
                              <span className="font-medium text-foreground/85">Work site:</span>{' '}
                              {employeeWorkSiteDisplay(employee)}
                            </span>
                          </div>
                          {aquacultureEnabled && (
                            <div className="flex items-center space-x-2 text-sm">
                              <Droplets className="h-4 w-4 text-primary shrink-0" />
                              <span className="text-muted-foreground">
                                <span className="font-medium text-foreground/85">Pond wages:</span>{' '}
                                {employeePondWagesDisplay(employee)}
                              </span>
                            </div>
                          )}
                          {employee.email && (
                            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                              <Mail className="h-4 w-4 text-muted-foreground/70 shrink-0" />
                              <span className="truncate">{employee.email}</span>
                            </div>
                          )}
                          {employee.phone && (
                            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                              <Phone className="h-4 w-4 text-muted-foreground/70 shrink-0" />
                              <span>{employee.phone}</span>
                            </div>
                          )}
                          {employee.hire_date && (
                            <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                              <span className="font-medium text-foreground/85">Hired:</span>
                              <span>
                                {formatDateLong(employee.hire_date)}
                              </span>
                            </div>
                          )}
                          {employee.salary != null && Number(employee.salary) > 0 && (
                            <div className="pt-3 border-t border-border">
                              <div className="flex items-center space-x-2">
                                <DollarSign className="h-5 w-5 text-success" />
                                <span className="text-xl font-bold text-foreground">
                                  {currencySymbol}
                                  {formatNumber(Number(employee.salary))}
                                </span>
                                <span className="text-sm text-muted-foreground">/month</span>
                              </div>
                            </div>
                          )}
                          {employee.current_balance != null && employee.current_balance !== '' && (
                            <div className="pt-2 text-sm text-muted-foreground">
                              <span className="font-medium text-foreground/85">Ledger balance:</span>{' '}
                              {currencySymbol}
                              {formatNumber(Number(employee.current_balance))}
                            </div>
                          )}
                        </div>

                        <div className="px-6 py-4 bg-muted/40 border-t border-border flex flex-wrap items-center justify-end gap-2">
                          <AskBrainButton
                            entityType="employee"
                            entityId={employee.id}
                            entityName={`${employee.first_name} ${employee.last_name || ''}`.trim()}
                            compact
                          />
                          <Link
                            href={`/employees/${employee.id}/ledger`}
                            className="flex items-center space-x-2 px-4 py-2 text-emerald-700 hover:bg-emerald-100 rounded-lg transition-colors font-medium text-sm"
                            title="Employee ledger"
                          >
                            <BookOpen className="h-4 w-4" />
                            <span>Ledger</span>
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleEdit(employee)}
                            className="flex items-center space-x-2 px-4 py-2 text-primary hover:bg-blue-100 rounded-lg transition-colors font-medium text-sm"
                            title="Edit Employee"
                          >
                            <Edit2 className="h-4 w-4" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(employee.id)}
                            className="flex items-center space-x-2 px-4 py-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors font-medium text-sm"
                            title="Delete Employee"
                          >
                            <Trash2 className="h-4 w-4" />
                            <span>Delete</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {employees.length > 0 && filteredEmployees.length > 0 && viewMode === 'list' && (
                  <div className="bg-white rounded-lg shadow-md border border-border overflow-hidden overflow-x-auto">
                    <table className="min-w-full divide-y divide-border">
                      <thead className="bg-muted/40">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Code
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Name
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden sm:table-cell">
                            Work site
                          </th>
                          {aquacultureEnabled && (
                            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                              Pond
                            </th>
                          )}
                          <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden lg:table-cell">
                            Job / Dept
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                            Contact
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Salary
                          </th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Status
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-border">
                        {filteredEmployees.map((employee) => (
                          <tr key={employee.id} className="hover:bg-muted/40">
                            <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-foreground">
                              {employee.employee_number || employee.employee_code || '—'}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              <div className="font-medium text-foreground">
                                {employee.first_name} {employee.last_name}
                              </div>
                              <div className="text-xs text-muted-foreground md:hidden mt-0.5 truncate max-w-[200px]">
                                {employee.email || employee.phone || ''}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-muted-foreground hidden sm:table-cell max-w-[10rem]">
                              <span className="inline-flex items-center gap-1">
                                <Building2 className="h-3.5 w-3.5 shrink-0 text-amber-600/80" />
                                <span className="truncate" title={employeeWorkSiteDisplay(employee)}>
                                  {employeeWorkSiteDisplay(employee)}
                                </span>
                              </span>
                            </td>
                            {aquacultureEnabled && (
                              <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell max-w-[10rem]">
                                <span className="inline-flex items-center gap-1">
                                  <Droplets className="h-3.5 w-3.5 shrink-0 text-primary/90" />
                                  <span
                                    className="truncate"
                                    title={employeePondWagesDisplay(employee)}
                                  >
                                    {employee.aquaculture_labor_scope === 'not_applicable'
                                      ? 'Not set'
                                      : employee.aquaculture_labor_scope === 'all_ponds_equal'
                                        ? 'All ponds (equal)'
                                        : (employee.home_aquaculture_pond_name || '').trim() || 'Not set'}
                                  </span>
                                </span>
                              </td>
                            )}
                            <td className="px-4 py-3 text-sm text-muted-foreground hidden lg:table-cell">
                              <div>{employee.position || employee.job_title || '—'}</div>
                              {employee.department && (
                                <div className="text-xs text-muted-foreground">{employee.department}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-muted-foreground hidden md:table-cell">
                              <div className="flex items-center gap-1 truncate max-w-[180px]">
                                {employee.email && (
                                  <>
                                    <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                                    <span className="truncate">{employee.email}</span>
                                  </>
                                )}
                              </div>
                              {employee.phone && (
                                <div className="flex items-center gap-1 mt-1">
                                  <Phone className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                                  <span>{employee.phone}</span>
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-foreground">
                              {employee.salary != null && Number(employee.salary) > 0 ? (
                                <>
                                  {currencySymbol}
                                  {formatNumber(Number(employee.salary))}
                                </>
                              ) : (
                                '—'
                              )}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-center">
                              <span
                                className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                                  employee.is_active
                                    ? 'bg-success/15 text-success'
                                    : 'bg-destructive/10 text-destructive'
                                }`}
                              >
                                {employee.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-right text-sm">
                              <div className="flex items-center justify-end gap-1">
                                <AskBrainButton
                                  entityType="employee"
                                  entityId={employee.id}
                                  entityName={`${employee.first_name} ${employee.last_name || ''}`.trim()}
                                  compact
                                  className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-800 hover:bg-indigo-100"
                                />
                                <Link
                                  href={`/employees/${employee.id}/ledger`}
                                  className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg"
                                  title="Ledger"
                                >
                                  <BookOpen className="h-4 w-4" />
                                </Link>
                                <button
                                  type="button"
                                  onClick={() => handleEdit(employee)}
                                  className="p-2 text-primary hover:bg-accent rounded-lg"
                                  title="Edit"
                                >
                                  <Edit2 className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(employee.id)}
                                  className="p-2 text-destructive hover:bg-destructive/5 rounded-lg"
                                  title="Delete"
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

                {employees.length === 0 && (
                  <div className="bg-white rounded-lg shadow-md p-12 text-center border border-border">
                    <User className="h-16 w-16 text-muted-foreground/70 mx-auto mb-4" />
                    <h3 className="text-xl font-semibold text-foreground mb-2">No Employees Found</h3>
                    <p className="text-muted-foreground mb-6">Get started by adding your first employee to the system.</p>
                    <button 
                      type="button"
                      onClick={() => {
                        resetForm()
                        setEmpCodePickerNonce((n) => n + 1)
                        setShowModal(true)
                      }}
                      className="inline-flex items-center space-x-2 px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary transition-colors shadow-md"
                    >
                      <Plus className="h-5 w-5" />
                      <span>Add First Employee</span>
                    </button>
                  </div>
                )}

                {employees.length > 0 && filteredEmployees.length === 0 && (
                  <div className="bg-white rounded-lg shadow-md p-12 text-center border border-border">
                    <Search className="h-16 w-16 text-muted-foreground/70 mx-auto mb-4" />
                    <h3 className="text-xl font-semibold text-foreground mb-2">No Matching Employees</h3>
                    <p className="text-muted-foreground mb-6">
                      No employees match your search or filter. Try adjusting your criteria.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchTerm('')
                        setFilterActive('all')
                      }}
                      className="inline-flex items-center space-x-2 px-6 py-3 bg-muted-foreground text-white rounded-lg hover:bg-muted-foreground transition-colors"
                    >
                      <span>Clear filters</span>
                    </button>
                  </div>
                )}
              </>
            )}
          </ErpPageShell>
        </div>

        {/* QuickBooks-style Employee Modal */}
          {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-[1440px] w-full max-h-[96vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="erp-hero-strip">
              <div className="flex items-center space-x-3">
                <User className="h-6 w-6 text-white" />
                <h2 className="text-2xl font-bold text-white">
                  {editingId ? 'Edit Employee' : 'New Employee'}
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
            <form onSubmit={editingId ? handleUpdate : handleCreate} className="p-6">
              <div className="space-y-6">
                {/* Basic Information Section */}
                <div className="border-b pb-6">
                  <div className="flex items-center space-x-2 mb-4">
                    <User className="h-5 w-5 text-primary" />
                    <h3 className="text-lg font-semibold text-foreground">Basic Information</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      {editingId ? (
                        <ReferenceCodePicker
                          kind="employee"
                          id="emp_code_ro"
                          label="Employee code"
                          value={formData.employee_code}
                          onChange={() => {}}
                          disabled
                        />
                      ) : (
                        <ReferenceCodePicker
                          key={empCodePickerNonce}
                          kind="employee"
                          id="emp_code"
                          label="Employee code"
                          value={formData.employee_code}
                          onChange={(c) => setFormData((prev) => ({ ...prev, employee_code: c }))}
                        />
                      )}
                      {!editingId && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          The lowest free code is selected by default. You can pick another from the list (gaps and next
                          number after the highest in use).
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">
                        First Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.first_name}
                        onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                        placeholder="John"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">
                        Last Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.last_name}
                        onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                        placeholder="Doe"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">
                        Email
                      </label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                        placeholder="john.doe@example.com"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">
                        Phone
                      </label>
                      <input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                        placeholder="+1 234 567 8900"
                      />
                    </div>
                  </div>
                </div>

                {/* Employment Information Section */}
                <div className="border-b pb-6">
                  <div className="flex items-center space-x-2 mb-4">
                    <Briefcase className="h-5 w-5 text-primary" />
                    <h3 className="text-lg font-semibold text-foreground">Employment Information</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">
                        Job Title
                      </label>
                      <input
                        type="text"
                        value={formData.job_title}
                        onChange={(e) => setFormData({ ...formData, job_title: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                        placeholder="Manager"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">
                        Department
                      </label>
                      <input
                        type="text"
                        value={formData.department}
                        onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                        placeholder="Sales"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-foreground/85 mb-2 inline-flex items-center gap-1.5">
                        <Building2 className="h-4 w-4 text-amber-600" />
                        Work entity
                      </label>
                      <select
                        value={workEntityKey}
                        onChange={(e) => {
                          const patch = applyWorkEntityKey(e.target.value)
                          setFormData({ ...formData, ...patch })
                        }}
                        className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring bg-white"
                      >
                        <optgroup label="Company">
                          <option value="head_office">Head office / company-wide (no site or pond tag)</option>
                        </optgroup>
                        {stations.length > 0 ? (
                          <optgroup label="Fuel stations & shops">
                            {stations.map((s) => (
                              <option key={s.id} value={`station:${s.id}`}>
                                {s.station_name}
                                {s.operates_fuel_retail === false ? ' (shop)' : ' (fuel station)'}
                              </option>
                            ))}
                          </optgroup>
                        ) : null}
                        {aquacultureEnabled && aquaculturePonds.length > 0 ? (
                          <optgroup label="Aquaculture ponds">
                            {aquaculturePonds.map((p) => (
                              <option key={p.id} value={`pond:${p.id}`}>
                                {p.name}
                                {p.is_active === false ? ' (inactive)' : ''}
                              </option>
                            ))}
                          </optgroup>
                        ) : null}
                        {aquacultureEnabled ? (
                          <optgroup label="Aquaculture (shared)">
                            <option value="all_ponds">All ponds (equal share) — shared aquaculture manager</option>
                          </optgroup>
                        ) : null}
                      </select>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {workSiteIsFuelOrShop ? (
                          <>
                            Site payroll — wages post to account <span className="font-mono text-primary">6400</span>{' '}
                            on this station.
                          </>
                        ) : workSiteIsSinglePond ? (
                          <>
                            Pond worker — wages post to account <span className="font-mono text-primary">6712</span>{' '}
                            on this profit center.
                          </>
                        ) : isSharedAcrossAllPonds ? (
                          <>Salary is divided equally across all active ponds when you run payroll.</>
                        ) : (
                          <>
                            Head-office or shared staff with no site or pond tag on payroll. Use a fuel station, shop,
                            or pond above when wages belong to a specific entity.
                          </>
                        )}
                      </p>
                      {aquacultureEnabled && aquaculturePonds.length === 0 && !workSiteIsFuelOrShop ? (
                        <p className="mt-1 text-xs text-warning-foreground">
                          No ponds yet — add them under{' '}
                          <Link href="/aquaculture/ponds" className="font-medium underline">
                            Aquaculture → Ponds
                          </Link>{' '}
                          to assign pond workers.
                        </p>
                      ) : null}
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">
                        Hire Date
                      </label>
                      <input
                        type="date"
                        value={formData.hire_date}
                        onChange={(e) => setFormData({ ...formData, hire_date: e.target.value })}
                        className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                      />
                    </div>
                  </div>
                </div>

                {/* Payroll Information Section */}
                <div className="pb-6">
                  <div className="flex items-center space-x-2 mb-4">
                    <DollarSign className="h-5 w-5 text-primary" />
                    <h3 className="text-lg font-semibold text-foreground">Payroll Information</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">
                        Salary
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">{currencySymbol}</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={formData.salary}
                          onChange={(e) => setFormData({ ...formData, salary: e.target.value })}
                          className="w-full pl-8 pr-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">
                        Opening balance ({currencySymbol})
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                          {currencySymbol}
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          value={formData.opening_balance}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              opening_balance: parseFloat(e.target.value) || 0,
                            })
                          }
                          className="w-full pl-8 pr-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                          placeholder="0.00"
                        />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {editingId
                          ? 'Update opening balance if needed'
                          : 'Starting net payable to this employee (positive) or advance owed by employee (negative)'}
                      </p>
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">
                        Opening balance as of
                      </label>
                      <input
                        type="date"
                        value={formData.opening_balance_date}
                        onChange={(e) =>
                          setFormData({ ...formData, opening_balance_date: e.target.value })
                        }
                        className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">Date shown on the employee ledger opening line</p>
                    </div>
                    <div className="flex items-center md:col-span-2">
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.is_active}
                          onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                          className="w-4 h-4 text-primary border-border rounded focus:ring-ring"
                        />
                        <span className="text-sm font-medium text-foreground/85">Active Employee</span>
                      </label>
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
                  className="px-4 py-2 text-foreground/85 bg-muted rounded-lg hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="erp-btn-primary transition-colors"
                >
                  {editingId ? 'Update Employee' : 'Add Employee'}
                </button>
              </div>
            </form>
            </div>
          </div>
        )}
      </PageLayout>
    </CompanyProvider>
  )
}

