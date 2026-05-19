'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { MasterCompanyBanner, TenantCompanyBanner } from '@/components/MasterCompanyBanner'
import { Plus, Edit2, Trash2, Mail, Phone, X, User, Briefcase, DollarSign, MapPin, Building2, AlertTriangle, RefreshCw, Search, Filter, BookOpen, Grid3x3, List, Droplets } from 'lucide-react'
import { useToast } from '@/components/Toast'
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
  is_active: boolean
  /** Primary work site (ops / reporting) */
  home_station_id?: number | null
  home_station_name?: string | null
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

function stationIsFuelForecourt(station: StationOption | undefined): boolean {
  return station != null && station.operates_fuel_retail !== false
}

function laborScopeForStation(
  stationId: string | number,
  stations: StationOption[]
): AquacultureLaborScope {
  if (stationId === '' || stationId == null) return 'not_applicable'
  const st = stations.find((s) => String(s.id) === String(stationId))
  if (!st) return 'not_applicable'
  if (stationIsFuelForecourt(st)) return 'not_applicable'
  return 'assigned_pond'
}

interface PondOption {
  id: number
  name: string
  is_active?: boolean
}

export default function EmployeesPage() {
  const router = useRouter()
  const toast = useToast()
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
      is_active: true,
      home_station_id: '',
      home_aquaculture_pond_id: '',
      aquaculture_labor_scope: 'not_applicable',
    })
    setEditingId(null)
  }

  const isSharedAcrossAllPonds = formData.aquaculture_labor_scope === 'all_ponds_equal'
  const isPondLaborNotApplicable = formData.aquaculture_labor_scope === 'not_applicable'
  const showPondProfitCenter = aquacultureEnabled && formData.aquaculture_labor_scope === 'assigned_pond'
  const selectedStation = stations.find((s) => String(s.id) === String(formData.home_station_id))

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.first_name || !formData.last_name) {
      toast.error('Please fill in required fields (First Name, Last Name)')
      return
    }

    try {
      const token = localStorage.getItem('access_token')
      const baseUrl = getApiBaseUrl()
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
        is_active: formData.is_active,
      }
      if (code) {
        body.employee_code = code
      }
      if (formData.home_station_id !== '' && formData.home_station_id != null) {
        const hid = parseInt(String(formData.home_station_id), 10)
        if (!Number.isNaN(hid)) {
          body.home_station_id = hid
        }
      } else {
        body.home_station_id = null
      }
      if (aquacultureEnabled) {
        body.aquaculture_labor_scope = formData.aquaculture_labor_scope
        if (
          formData.aquaculture_labor_scope === 'all_ponds_equal' ||
          formData.aquaculture_labor_scope === 'not_applicable'
        ) {
          body.home_aquaculture_pond_id = null
        } else if (formData.home_aquaculture_pond_id !== '' && formData.home_aquaculture_pond_id != null) {
          const pid = parseInt(String(formData.home_aquaculture_pond_id), 10)
          if (!Number.isNaN(pid)) body.home_aquaculture_pond_id = pid
        } else {
          body.home_aquaculture_pond_id = null
        }
      }
      const response = await fetch(`${baseUrl}/employees/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        mode: 'cors',
        credentials: 'omit',
        body: JSON.stringify(body)
      })

      if (response.ok) {
        toast.success('Employee created successfully!')
        setShowModal(false)
        resetForm()
        fetchEmployees()
      } else {
        const error = await response.json()
        toast.error(error.detail || 'Failed to create employee')
      }
    } catch (error) {
      console.error('Error creating employee:', error)
      toast.error('Error connecting to server')
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
      const token = localStorage.getItem('access_token')
      const baseUrl = getApiBaseUrl()
      const response = await fetch(`${baseUrl}/employees/${editingId}/`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        mode: 'cors',
        credentials: 'omit',
        body: JSON.stringify({
          first_name: formData.first_name,
          last_name: formData.last_name,
          email: formData.email || null,
          phone: formData.phone || null,
          hire_date: formData.hire_date || null,
          job_title: formData.job_title || null,
          department: formData.department || null,
          salary: formData.salary ? parseFloat(formData.salary) : null,
          is_active: formData.is_active,
          home_station_id:
            formData.home_station_id !== '' && formData.home_station_id != null
              ? parseInt(String(formData.home_station_id), 10)
              : null,
          ...(aquacultureEnabled
            ? {
                aquaculture_labor_scope: formData.aquaculture_labor_scope,
                home_aquaculture_pond_id:
                  formData.aquaculture_labor_scope === 'assigned_pond' &&
                  formData.home_aquaculture_pond_id !== '' &&
                  formData.home_aquaculture_pond_id != null
                    ? parseInt(String(formData.home_aquaculture_pond_id), 10)
                    : null,
              }
            : {}),
        })
      })

      if (response.ok) {
        toast.success('Employee updated successfully!')
        setShowModal(false)
        resetForm()
        fetchEmployees()
      } else {
        const error = await response.json()
        toast.error(error.detail || 'Failed to update employee')
      }
    } catch (error) {
      console.error('Error updating employee:', error)
      toast.error('Error connecting to server')
    }
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this employee?')) return

    try {
      const token = localStorage.getItem('access_token')
      const baseUrl = getApiBaseUrl()
      const response = await fetch(`${baseUrl}/employees/${id}/`, {
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
        toast.success('Employee deleted successfully!')
        fetchEmployees()
      } else {
        toast.error('Failed to delete employee')
      }
    } catch (error) {
      console.error('Error deleting employee:', error)
      toast.error('Error connecting to server')
    }
  }

  if (loading) {
    return (
      <CompanyProvider>
        <div className="flex min-h-screen items-center justify-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </CompanyProvider>
    )
  }

  return (
    <CompanyProvider>
      <div className="flex h-screen bg-gray-100 page-with-sidebar">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          {error ? (
            <div className="flex-1 overflow-auto app-scroll-pad">
              <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
                <AlertTriangle className="h-12 w-12 text-red-600 mx-auto mb-4" />
                <h3 className="text-xl font-bold text-red-800 mb-2">Error Loading Employees</h3>
                <p className="text-red-700 mb-4">{error}</p>
                <button
                  onClick={fetchEmployees}
                  className="inline-flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  <RefreshCw className="h-5 w-5" />
                  <span>Retry</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-auto">
              {/* Master/Tenant Company Banner */}
              <MasterCompanyBanner />
              <TenantCompanyBanner />
              
              <div className="app-scroll-pad">
                <div className="flex items-center justify-between mb-8">
                  <div>
                    <h1 className="text-3xl font-bold text-gray-900">Employees</h1>
                    <p className="text-gray-600 mt-1">Manage your workforce</p>
                  </div>
                  <button 
                    type="button"
                    onClick={() => {
                      resetForm()
                      setEmpCodePickerNonce((n) => n + 1)
                      setShowModal(true)
                    }}
                    className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-md"
                  >
                    <Plus className="h-5 w-5" />
                    <span>New Employee</span>
                  </button>
                </div>

                {/* Search and Filter Bar */}
                <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-col md:flex-row gap-4 flex-1 min-w-0">
                      <div className="flex-1 relative min-w-0">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Search by name, code, email, phone, work site, or pond…"
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                      </div>
                      <div className="flex items-center space-x-2 shrink-0">
                        <Filter className="h-5 w-5 text-gray-400" />
                        <select
                          value={filterActive}
                          onChange={(e) => setFilterActive(e.target.value as 'all' | 'active' | 'inactive')}
                          className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        >
                          <option value="all">All Employees</option>
                          <option value="active">Active Only</option>
                          <option value="inactive">Inactive Only</option>
                        </select>
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2 shrink-0">
                      <div className="flex items-center bg-gray-100 rounded-lg p-1">
                        <button
                          type="button"
                          onClick={() => {
                            setViewMode('card')
                            localStorage.setItem('employees_view_mode', 'card')
                          }}
                          className={`p-2 rounded transition-colors ${
                            viewMode === 'card'
                              ? 'bg-white text-blue-600 shadow-sm'
                              : 'text-gray-600 hover:text-gray-900'
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
                              ? 'bg-white text-blue-600 shadow-sm'
                              : 'text-gray-600 hover:text-gray-900'
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
                  <div className="mb-4 text-sm text-gray-600">
                    Showing {filteredEmployees.length} of {employees.length} employee
                    {employees.length !== 1 ? 's' : ''}
                  </div>
                )}

                {employees.length > 0 && filteredEmployees.length > 0 && viewMode === 'card' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredEmployees.map((employee) => (
                      <div
                        key={employee.id}
                        className="bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow border border-gray-200 overflow-hidden"
                      >
                        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-6 py-4 border-b border-gray-200">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3 min-w-0">
                              <div className="h-12 w-12 shrink-0 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-lg">
                                {employee.first_name.charAt(0)}
                                {(employee.last_name || '').charAt(0)}
                              </div>
                              <div className="min-w-0">
                                <h3 className="text-lg font-semibold text-gray-900 truncate">
                                  {employee.first_name} {employee.last_name}
                                </h3>
                                <p className="text-sm text-gray-500 font-mono truncate">
                                  {employee.employee_number || employee.employee_code}
                                </p>
                              </div>
                            </div>
                            <span
                              className={`shrink-0 px-3 py-1 text-xs font-semibold rounded-full ${
                                employee.is_active
                                  ? 'bg-green-100 text-green-800 border border-green-200'
                                  : 'bg-red-100 text-red-800 border border-red-200'
                              }`}
                            >
                              {employee.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </div>
                        </div>

                        <div className="p-6 space-y-3">
                          {(employee.position || employee.job_title) && (
                            <div className="flex items-center space-x-2 text-sm">
                              <Briefcase className="h-4 w-4 text-gray-400 shrink-0" />
                              <span className="text-gray-600">
                                <span className="font-medium text-gray-700">Position:</span>{' '}
                                {employee.position || employee.job_title}
                              </span>
                            </div>
                          )}
                          {employee.department && (
                            <div className="flex items-center space-x-2 text-sm">
                              <MapPin className="h-4 w-4 text-gray-400 shrink-0" />
                              <span className="text-gray-600">
                                <span className="font-medium text-gray-700">Department:</span>{' '}
                                {employee.department}
                              </span>
                            </div>
                          )}
                          <div className="flex items-center space-x-2 text-sm">
                            <Building2 className="h-4 w-4 text-amber-600/90 shrink-0" />
                            <span className="text-gray-600">
                              <span className="font-medium text-gray-700">Work site:</span>{' '}
                              {(employee.home_station_name || '').trim() ||
                                (employee.home_station_id
                                  ? `Site #${employee.home_station_id}`
                                  : '—')}
                            </span>
                          </div>
                          {aquacultureEnabled && (
                            <div className="flex items-center space-x-2 text-sm">
                              <Droplets className="h-4 w-4 text-teal-600 shrink-0" />
                              <span className="text-gray-600">
                                <span className="font-medium text-gray-700">Pond wages:</span>{' '}
                                {employee.aquaculture_labor_scope === 'not_applicable'
                                  ? 'Not applicable'
                                  : employee.aquaculture_labor_scope === 'all_ponds_equal'
                                    ? 'All ponds (equal share)'
                                    : (employee.home_aquaculture_pond_name || '').trim() ||
                                      (employee.home_aquaculture_pond_id
                                        ? `Pond #${employee.home_aquaculture_pond_id}`
                                        : '—')}
                              </span>
                            </div>
                          )}
                          {employee.email && (
                            <div className="flex items-center space-x-2 text-sm text-gray-600">
                              <Mail className="h-4 w-4 text-gray-400 shrink-0" />
                              <span className="truncate">{employee.email}</span>
                            </div>
                          )}
                          {employee.phone && (
                            <div className="flex items-center space-x-2 text-sm text-gray-600">
                              <Phone className="h-4 w-4 text-gray-400 shrink-0" />
                              <span>{employee.phone}</span>
                            </div>
                          )}
                          {employee.hire_date && (
                            <div className="flex items-center space-x-2 text-sm text-gray-600">
                              <span className="font-medium text-gray-700">Hired:</span>
                              <span>
                                {formatDateLong(employee.hire_date)}
                              </span>
                            </div>
                          )}
                          {employee.salary != null && Number(employee.salary) > 0 && (
                            <div className="pt-3 border-t border-gray-200">
                              <div className="flex items-center space-x-2">
                                <DollarSign className="h-5 w-5 text-green-600" />
                                <span className="text-xl font-bold text-gray-900">
                                  {currencySymbol}
                                  {formatNumber(Number(employee.salary))}
                                </span>
                                <span className="text-sm text-gray-500">/month</span>
                              </div>
                            </div>
                          )}
                          {employee.current_balance != null && employee.current_balance !== '' && (
                            <div className="pt-2 text-sm text-gray-600">
                              <span className="font-medium text-gray-700">Ledger balance:</span>{' '}
                              {currencySymbol}
                              {formatNumber(Number(employee.current_balance))}
                            </div>
                          )}
                        </div>

                        <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex flex-wrap items-center justify-end gap-2">
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
                            className="flex items-center space-x-2 px-4 py-2 text-blue-600 hover:bg-blue-100 rounded-lg transition-colors font-medium text-sm"
                            title="Edit Employee"
                          >
                            <Edit2 className="h-4 w-4" />
                            <span>Edit</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(employee.id)}
                            className="flex items-center space-x-2 px-4 py-2 text-red-600 hover:bg-red-100 rounded-lg transition-colors font-medium text-sm"
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
                  <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Code
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Name
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden sm:table-cell">
                            Work site
                          </th>
                          {aquacultureEnabled && (
                            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">
                              Pond
                            </th>
                          )}
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden lg:table-cell">
                            Job / Dept
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">
                            Contact
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Salary
                          </th>
                          <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Status
                          </th>
                          <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {filteredEmployees.map((employee) => (
                          <tr key={employee.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 whitespace-nowrap text-sm font-mono text-gray-900">
                              {employee.employee_number || employee.employee_code || '—'}
                            </td>
                            <td className="px-4 py-3 text-sm">
                              <div className="font-medium text-gray-900">
                                {employee.first_name} {employee.last_name}
                              </div>
                              <div className="text-xs text-gray-500 md:hidden mt-0.5 truncate max-w-[200px]">
                                {employee.email || employee.phone || ''}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600 hidden sm:table-cell max-w-[10rem]">
                              <span className="inline-flex items-center gap-1">
                                <Building2 className="h-3.5 w-3.5 shrink-0 text-amber-600/80" />
                                <span className="truncate" title={employee.home_station_name || ''}>
                                  {(employee.home_station_name || '').trim() || '—'}
                                </span>
                              </span>
                            </td>
                            {aquacultureEnabled && (
                              <td className="px-4 py-3 text-sm text-gray-600 hidden md:table-cell max-w-[10rem]">
                                <span className="inline-flex items-center gap-1">
                                  <Droplets className="h-3.5 w-3.5 shrink-0 text-teal-600/90" />
                                  <span
                                    className="truncate"
                                    title={
                                      employee.aquaculture_labor_scope === 'not_applicable'
                                        ? 'Not applicable (site payroll)'
                                        : employee.aquaculture_labor_scope === 'all_ponds_equal'
                                          ? 'All ponds (equal share)'
                                          : employee.home_aquaculture_pond_name || ''
                                    }
                                  >
                                    {employee.aquaculture_labor_scope === 'not_applicable'
                                      ? 'N/A'
                                      : employee.aquaculture_labor_scope === 'all_ponds_equal'
                                        ? 'All ponds (equal)'
                                        : (employee.home_aquaculture_pond_name || '').trim() || '—'}
                                  </span>
                                </span>
                              </td>
                            )}
                            <td className="px-4 py-3 text-sm text-gray-600 hidden lg:table-cell">
                              <div>{employee.position || employee.job_title || '—'}</div>
                              {employee.department && (
                                <div className="text-xs text-gray-500">{employee.department}</div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600 hidden md:table-cell">
                              <div className="flex items-center gap-1 truncate max-w-[180px]">
                                {employee.email && (
                                  <>
                                    <Mail className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                                    <span className="truncate">{employee.email}</span>
                                  </>
                                )}
                              </div>
                              {employee.phone && (
                                <div className="flex items-center gap-1 mt-1">
                                  <Phone className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                                  <span>{employee.phone}</span>
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">
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
                                    ? 'bg-green-100 text-green-800'
                                    : 'bg-red-100 text-red-800'
                                }`}
                              >
                                {employee.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-right text-sm">
                              <div className="flex items-center justify-end gap-1">
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
                                  className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg"
                                  title="Edit"
                                >
                                  <Edit2 className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(employee.id)}
                                  className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
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
                  <div className="bg-white rounded-lg shadow-md p-12 text-center border border-gray-200">
                    <User className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-xl font-semibold text-gray-900 mb-2">No Employees Found</h3>
                    <p className="text-gray-500 mb-6">Get started by adding your first employee to the system.</p>
                    <button 
                      type="button"
                      onClick={() => {
                        resetForm()
                        setEmpCodePickerNonce((n) => n + 1)
                        setShowModal(true)
                      }}
                      className="inline-flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-md"
                    >
                      <Plus className="h-5 w-5" />
                      <span>Add First Employee</span>
                    </button>
                  </div>
                )}

                {employees.length > 0 && filteredEmployees.length === 0 && (
                  <div className="bg-white rounded-lg shadow-md p-12 text-center border border-gray-200">
                    <Search className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                    <h3 className="text-xl font-semibold text-gray-900 mb-2">No Matching Employees</h3>
                    <p className="text-gray-500 mb-6">
                      No employees match your search or filter. Try adjusting your criteria.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSearchTerm('')
                        setFilterActive('all')
                      }}
                      className="inline-flex items-center space-x-2 px-6 py-3 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      <span>Clear filters</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* QuickBooks-style Employee Modal */}
          {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-6 py-4 sticky top-0 z-10 flex items-center justify-between rounded-t-xl">
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
                    <User className="h-5 w-5 text-blue-600" />
                    <h3 className="text-lg font-semibold text-gray-900">Basic Information</h3>
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
                        <p className="mt-1 text-xs text-gray-500">
                          The lowest free code is selected by default. You can pick another from the list (gaps and next
                          number after the highest in use).
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        First Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.first_name}
                        onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="John"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Last Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.last_name}
                        onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Doe"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Email
                      </label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="john.doe@example.com"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Phone
                      </label>
                      <input
                        type="tel"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="+1 234 567 8900"
                      />
                    </div>
                  </div>
                </div>

                {/* Employment Information Section */}
                <div className="border-b pb-6">
                  <div className="flex items-center space-x-2 mb-4">
                    <Briefcase className="h-5 w-5 text-blue-600" />
                    <h3 className="text-lg font-semibold text-gray-900">Employment Information</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Job Title
                      </label>
                      <input
                        type="text"
                        value={formData.job_title}
                        onChange={(e) => setFormData({ ...formData, job_title: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Manager"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Department
                      </label>
                      <input
                        type="text"
                        value={formData.department}
                        onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        placeholder="Sales"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2 inline-flex items-center gap-1.5">
                        <Building2 className="h-4 w-4 text-amber-600" />
                        Work site (station)
                      </label>
                      <select
                        value={formData.home_station_id === '' ? '' : String(formData.home_station_id)}
                        onChange={(e) => {
                          const stationId = e.target.value === '' ? '' : e.target.value
                          const nextScope =
                            stationId === ''
                              ? formData.aquaculture_labor_scope
                              : laborScopeForStation(stationId, stations)
                          setFormData({
                            ...formData,
                            home_station_id: stationId,
                            ...(aquacultureEnabled
                              ? {
                                  aquaculture_labor_scope:
                                    stationId === ''
                                      ? formData.aquaculture_labor_scope
                                      : nextScope,
                                  ...(nextScope !== 'assigned_pond'
                                    ? { home_aquaculture_pond_id: '' }
                                    : {}),
                                }
                              : {}),
                          })
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                      >
                        <option value="">— Not set —</option>
                        {stations.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.station_name}
                            {s.operates_fuel_retail === false ? ' (shop)' : ''}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-gray-500">
                        Operational work site (fuel forecourt, agro shop, or office). Used for rosters and
                        site reporting — separate from pond profit-center payroll.
                      </p>
                    </div>
                    {aquacultureEnabled && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Wage attribution (aquaculture)
                        </label>
                        <select
                          value={formData.aquaculture_labor_scope}
                          onChange={(e) => {
                            const scope = e.target.value as AquacultureLaborScope
                            setFormData({
                              ...formData,
                              aquaculture_labor_scope: scope,
                              ...(scope !== 'assigned_pond' ? { home_aquaculture_pond_id: '' } : {}),
                            })
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white"
                        >
                          <option value="not_applicable">
                            — Not applicable — (fuel / shop / site payroll)
                          </option>
                          <option value="assigned_pond">Single pond — field / pond worker</option>
                          <option value="all_ponds_equal">
                            All ponds (equal share) — shared aquaculture manager
                          </option>
                        </select>
                        <p className="mt-1 text-xs text-gray-500">
                          Controls whether payroll is split into aquaculture pond P&amp;L (account{' '}
                          <span className="font-mono text-teal-800">6712</span>). Choose{' '}
                          <span className="font-medium">Not applicable</span> for Main Station accountants,
                          Premium Agro shop staff, and other non-pond roles.
                        </p>
                        {selectedStation && stationIsFuelForecourt(selectedStation) && (
                          <p className="mt-1 text-xs text-amber-800">
                            {selectedStation.station_name} is a fuel forecourt — pond wage attribution is
                            usually not applicable.
                          </p>
                        )}
                      </div>
                    )}
                    {showPondProfitCenter && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 inline-flex items-center gap-1.5">
                          <Droplets className="h-4 w-4 text-teal-600" />
                          Aquaculture pond (profit center)
                        </label>
                        <select
                          value={
                            formData.home_aquaculture_pond_id === ''
                              ? ''
                              : String(formData.home_aquaculture_pond_id)
                          }
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              home_aquaculture_pond_id: e.target.value === '' ? '' : e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white"
                        >
                          <option value="">— Not assigned —</option>
                          {aquaculturePonds.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                              {p.is_active === false ? ' (inactive)' : ''}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-gray-500">
                          Required for pond workers: wages post to{' '}
                          <span className="font-mono text-teal-800">6712</span> on this profit center. For
                          agro shops linked to a pond, you may leave blank only if the shop site has a default
                          pond and this person&apos;s wages should follow that link.
                        </p>
                        {aquaculturePonds.length === 0 && (
                          <p className="mt-1 text-xs text-amber-800">
                            No ponds yet — add them under{' '}
                            <Link href="/aquaculture/ponds" className="font-medium underline">
                              Aquaculture → Ponds
                            </Link>
                            .
                          </p>
                        )}
                      </div>
                    )}
                    {aquacultureEnabled && isSharedAcrossAllPonds && (
                      <div className="rounded-lg border border-teal-200 bg-teal-50/80 px-3 py-2 text-xs text-teal-950 md:col-span-2">
                        Salary will be divided equally across all active ponds when you run payroll.
                      </div>
                    )}
                    {aquacultureEnabled && isPondLaborNotApplicable && (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800 md:col-span-2">
                        Wages stay on company / site payroll and are not allocated to aquaculture pond
                        P&amp;L. Aquaculture pond stays not assigned.
                      </div>
                    )}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Hire Date
                      </label>
                      <input
                        type="date"
                        value={formData.hire_date}
                        onChange={(e) => setFormData({ ...formData, hire_date: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                </div>

                {/* Payroll Information Section */}
                <div className="pb-6">
                  <div className="flex items-center space-x-2 mb-4">
                    <DollarSign className="h-5 w-5 text-blue-600" />
                    <h3 className="text-lg font-semibold text-gray-900">Payroll Information</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Salary
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">{currencySymbol}</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={formData.salary}
                          onChange={(e) => setFormData({ ...formData, salary: e.target.value })}
                          className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                    <div className="flex items-center">
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.is_active}
                          onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                          className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                        />
                        <span className="text-sm font-medium text-gray-700">Active Employee</span>
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
                  className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {editingId ? 'Update Employee' : 'Add Employee'}
                </button>
              </div>
            </form>
            </div>
          </div>
        )}
        </div>
      </div>
    </CompanyProvider>
  )
}

