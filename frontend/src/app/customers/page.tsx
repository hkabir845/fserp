'use client'

import { CompanyDateInput } from '@/components/CompanyDateInput'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { Plus, Edit, Trash2, Search, AlertTriangle, RefreshCw, Users, UserCheck, DollarSign, X, Mail, Phone, ArrowUpDown, ArrowUp, ArrowDown, BookOpen, Building2, Undo2 } from 'lucide-react'
import { DocumentExportButtons } from '@/components/DocumentExportButtons'
import { useToast } from '@/components/Toast'
import api, { getApiDocsUrl, getBackendOrigin } from '@/lib/api'
import { isOffsetPagedPayload, offsetListParams, REFERENCE_FETCH_LIMIT } from '@/lib/pagination'
import { OffsetPaginationControls } from '@/components/ui/OffsetPaginationControls'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { isConnectionError } from '@/utils/connectionError'
import { formatJsonApiError } from '@/utils/apiErrors'
import { extractErrorMessage } from '@/utils/errorHandler'
import { ReferenceCodePicker } from '@/components/ReferenceCodePicker'
import { formatDate } from '@/utils/date'
import {
  buildCustomerListCsv,
} from '@/utils/businessDocumentExport'
import { buildContactListPrintHtml } from '@/utils/listExportHelpers'
import { usePagedListExport } from '@/hooks/usePagedListExport'
import { usePageMeta } from '@/hooks/usePageMeta'
import { useT } from '@/lib/i18n'
import { useErpCommonT } from '@/lib/moduleI18n/erpCommon'
import { useContactsT } from '@/lib/moduleI18n/contacts'

interface Customer {
  id: number
  customer_number: string
  display_name: string | null
  email: string | null
  phone: string | null
  current_balance: number
  is_active: boolean
  company_name?: string | null
  first_name?: string | null
  opening_balance?: number
  opening_balance_date?: string
  billing_address_line1?: string | null
  billing_city?: string | null
  billing_state?: string | null
  billing_country?: string | null
  bank_account_number?: string | null
  bank_name?: string | null
  bank_branch?: string | null
  bank_routing_number?: string | null
  /** Primary site for sales / visits; new invoices default here */
  default_station_id?: number | null
  default_station_name?: string | null
}

interface StationOption {
  id: number
  station_name: string
  is_active?: boolean
}

export default function CustomersPage() {
  const router = useRouter()
  const toast = useToast()
  const pageMeta = usePageMeta()
  const { t } = useT()
  const tr = useErpCommonT()
  const ct = useContactsT()
  const backendOrigin = getBackendOrigin()
  const apiDocsUrl = getApiDocsUrl()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null)
  const [currencySymbol, setCurrencySymbol] = useState<string>('৳') // Default to BDT
  const [sortField, setSortField] = useState<keyof Customer | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [showDebug, setShowDebug] = useState(false)
  const [apiResponse, setApiResponse] = useState<any>(null)
  const [addingDummy, setAddingDummy] = useState(false)
  const [customerRefCode, setCustomerRefCode] = useState('')
  const [createCodeNonce, setCreateCodeNonce] = useState(0)
  const [listPage, setListPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [totalCount, setTotalCount] = useState(0)
  const [listStats, setListStats] = useState<{
    active_count: number
    total_balance: string
    total_receivable: string
  } | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [stations, setStations] = useState<StationOption[]>([])
  const [formData, setFormData] = useState({
    company_name: '',
    contact_person: '',
    email: '',
    phone: '',
    billing_address_line1: '',
    billing_city: '',
    billing_state: '',
    billing_country: '',
    bank_account_number: '',
    bank_name: '',
    bank_branch: '',
    bank_routing_number: '',
    opening_balance: 0,
    opening_balance_date: new Date().toISOString().split('T')[0],
    is_active: true,
    default_station_id: '' as string | number,
  })

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }

    fetchStationsList()
  }, [router])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), 350)
    return () => clearTimeout(t)
  }, [searchTerm])

  useEffect(() => {
    setListPage(1)
  }, [debouncedSearch, pageSize])

  const fetchStationsList = async () => {
    try {
      const res = await api.get<unknown[]>('/stations/', { timeout: 8000 })
      const rows = Array.isArray(res.data) ? res.data : []
      const parsed: StationOption[] = []
      for (const r of rows) {
        const o = r as { id?: number; station_name?: string; is_active?: boolean }
        if (typeof o.id !== 'number') continue
        if (o.is_active === false) continue
        parsed.push({ id: o.id, station_name: o.station_name || `Site #${o.id}`, is_active: o.is_active })
      }
      setStations(parsed)
    } catch {
      setStations([])
    }
  }

  const fetchCustomers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      try {
        const companyRes = await Promise.race([
          api.get('/companies/current', { timeout: 5000 }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
        ]) as { data?: { currency?: string } }
        if (companyRes?.data?.currency) {
          setCurrencySymbol(getCurrencySymbol(companyRes.data.currency))
        }
      } catch (error) {
        if (!isConnectionError(error)) {
          console.warn('Error fetching company currency (non-critical):', error)
        }
      }

      try {
        const params = offsetListParams({
          page: listPage,
          pageSize,
          q: debouncedSearch,
          sort: sortField || 'id',
          dir: sortDirection,
          extra: { include_inactive: includeInactive ? 'true' : undefined },
        })
        const response = await api.get('/customers/', { params, timeout: 15000 })
        const data = response.data
        setApiResponse({ data, status: response.status, headers: response.headers })

        if (isOffsetPagedPayload(data)) {
          setCustomers(data.results as Customer[])
          setTotalCount(data.count)
          const st = data.stats as
            | { active_count?: number; total_balance?: string; total_receivable?: string }
            | undefined
          if (st && typeof st.active_count === 'number') {
            setListStats({
              active_count: st.active_count,
              total_balance: String(st.total_balance ?? '0'),
              total_receivable: String(st.total_receivable ?? '0'),
            })
          } else {
            setListStats(null)
          }
          setError(null)
          const totalPages = Math.max(1, Math.ceil(data.count / pageSize))
          if (listPage > totalPages) {
            setListPage(totalPages)
          }
        } else {
          console.error('Invalid paged data format received:', data)
          setError(tr('invalidDataFormat'))
          setCustomers([])
          setTotalCount(0)
          setListStats(null)
          toast.error(tr('invalidDataToast'))
        }
      } catch (apiError: unknown) {
        console.error('API Error fetching customers:', apiError)
        const ax = apiError as {
          code?: string
          message?: string
          response?: { status?: number; data?: { detail?: string } }
        }

        if (
          ax.code === 'ECONNABORTED' ||
          ax.message?.includes('timeout') ||
          ax.message?.includes('exceeded')
        ) {
          const errorMsg = ct('backendTimeoutDetail', { origin: backendOrigin })
          setError(errorMsg)
          toast.error(tr('backendTimeout'), 10000)
          setCustomers([])
          setTotalCount(0)
          setListStats(null)
          return
        }

        if (ax.response?.status === 401 || ax.response?.status === 403) {
          localStorage.removeItem('access_token')
          router.push('/login')
          return
        }

        if (
          !ax.response &&
          (ax.code === 'ECONNREFUSED' ||
            ax.message?.includes('Network Error') ||
            ax.message?.includes('Failed to fetch'))
        ) {
          const errorMsg = ct('cannotConnectDetail', { origin: backendOrigin })
          setError(errorMsg)
          toast.error(tr('cannotConnectBackend'), 10000)
          setCustomers([])
          setTotalCount(0)
          setListStats(null)
          return
        }

        const errorMsg = ax.response?.data?.detail || ax.message || tr('failedLoadEntity', { entity: ct('customers') })
        setError(errorMsg)
        toast.error(errorMsg)
        setCustomers([])
        setTotalCount(0)
        setListStats(null)
      }
    } catch (error) {
      console.error('Unexpected error fetching customers:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      let userMessage = tr('errorConnecting')

      if (errorMessage.includes('fetch') || errorMessage.includes('Failed to fetch')) {
        userMessage = ct('cannotConnectBackendOrigin', { origin: backendOrigin })
      } else {
        userMessage = `Error: ${errorMessage}`
      }

      setError(userMessage)
      toast.error(userMessage)
      setCustomers([])
      setTotalCount(0)
      setListStats(null)
    } finally {
      setLoading(false)
    }
  }, [
    backendOrigin,
    debouncedSearch,
    listPage,
    pageSize,
    router,
    sortDirection,
    sortField,
    includeInactive,
    toast,
  ])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) return
    void fetchCustomers()
  }, [fetchCustomers])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.post('/customers/', {
        company_name: formData.company_name || null,
        first_name: formData.contact_person || null,
        display_name: formData.company_name || formData.contact_person || '',
        email: formData.email || null,
        phone: formData.phone || null,
        billing_address_line1: formData.billing_address_line1 || null,
        billing_city: formData.billing_city || null,
        billing_state: formData.billing_state || null,
        billing_country: formData.billing_country || null,
        bank_account_number: formData.bank_account_number || null,
        bank_name: formData.bank_name || null,
        bank_branch: formData.bank_branch || null,
        bank_routing_number: formData.bank_routing_number || null,
        opening_balance: formData.opening_balance,
        opening_balance_date: formData.opening_balance_date || null,
        is_active: formData.is_active,
        default_station_id:
          formData.default_station_id !== '' && formData.default_station_id != null
            ? parseInt(String(formData.default_station_id), 10)
            : null,
        ...(customerRefCode.trim() ? { customer_number: customerRefCode.trim() } : {}),
      })
      toast.success(tr('entityCreated', { entity: ct('Customer') }))
      setShowModal(false)
      fetchCustomers()
      resetForm()
    } catch (error: unknown) {
      const ax = error as { response?: { data?: unknown; status?: number; statusText?: string } }
      const message = formatJsonApiError(
        ax.response?.data,
        tr('failedCreateEntity', { entity: ct('customer') }),
        ax.response
          ? { status: ax.response.status ?? 0, statusText: ax.response.statusText ?? '' }
          : undefined
      )
      console.error('Failed to create customer:', message)
      toast.error(message)
    }
  }

  const handleEdit = (customer: Customer) => {
    setEditingCustomer(customer)
    setFormData({
      company_name: customer.company_name || '',
      contact_person: customer.first_name || '',
      email: customer.email || '',
      phone: customer.phone || '',
      billing_address_line1: customer.billing_address_line1 || '',
      billing_city: customer.billing_city || '',
      billing_state: customer.billing_state || '',
      billing_country: customer.billing_country || '',
      bank_account_number: customer.bank_account_number || '',
      bank_name: customer.bank_name || '',
      bank_branch: customer.bank_branch || '',
      bank_routing_number: customer.bank_routing_number || '',
      opening_balance: Number(customer.opening_balance || customer.current_balance || 0),
      opening_balance_date: customer.opening_balance_date 
        ? new Date(customer.opening_balance_date).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0],
      is_active: customer.is_active,
      default_station_id:
        customer.default_station_id != null && customer.default_station_id > 0
          ? String(customer.default_station_id)
          : '',
    })
    setShowModal(true)
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingCustomer) return

    try {
      await api.put(`/customers/${editingCustomer.id}/`, {
        company_name: formData.company_name || null,
        first_name: formData.contact_person || null,
        display_name: formData.company_name || formData.contact_person || '',
        email: formData.email || null,
        phone: formData.phone || null,
        billing_address_line1: formData.billing_address_line1 || null,
        billing_city: formData.billing_city || null,
        billing_state: formData.billing_state || null,
        billing_country: formData.billing_country || null,
        bank_account_number: formData.bank_account_number || null,
        bank_name: formData.bank_name || null,
        bank_branch: formData.bank_branch || null,
        bank_routing_number: formData.bank_routing_number || null,
        is_active: formData.is_active,
        opening_balance: formData.opening_balance,
        opening_balance_date: formData.opening_balance_date || null,
        default_station_id:
          formData.default_station_id !== '' && formData.default_station_id != null
            ? parseInt(String(formData.default_station_id), 10)
            : null,
      })
      toast.success(tr('entityUpdated', { entity: ct('Customer') }))
      setShowModal(false)
      setEditingCustomer(null)
      fetchCustomers()
      resetForm()
    } catch (error: unknown) {
      const ax = error as { response?: { data?: unknown; status?: number; statusText?: string } }
      const message = formatJsonApiError(
        ax.response?.data,
        tr('failedUpdateEntity', { entity: ct('customer') }),
        ax.response
          ? { status: ax.response.status ?? 0, statusText: ax.response.statusText ?? '' }
          : undefined
      )
      console.error('Failed to update customer:', message)
      toast.error(message)
    }
  }

  const handleAddDummyCustomers = async () => {
    if (!confirm(ct('confirmDummyCustomers'))) {
      return
    }
    
    setAddingDummy(true)
    try {
      const response = await api.post('/customers/add-dummy')
      const newCustomers = response.data
      toast.success(ct('dummyCustomersAdded', { count: newCustomers.length }))
      // Refresh the customer list
      await fetchCustomers()
    } catch (error: any) {
      console.error('Error adding dummy customers:', error)
      const errorMsg = error.response?.data?.detail || error.message || ct('failedDummyCustomers')
      toast.error(errorMsg)
    } finally {
      setAddingDummy(false)
    }
  }

  const handleDelete = async (customerId: number) => {
    try {
      await api.delete(`/customers/${customerId}/`)
      toast.success(tr('entityDeleted', { entity: ct('Customer') }) + ' You can restore inactive customers when needed.')
      setShowDeleteConfirm(null)
      fetchCustomers()
    } catch (error: unknown) {
      const ax = error as { response?: { data?: unknown; status?: number; statusText?: string } }
      const message = formatJsonApiError(
        ax.response?.data,
        tr('failedDeleteEntity', { entity: ct('customer') }),
        ax.response
          ? { status: ax.response.status ?? 0, statusText: ax.response.statusText ?? '' }
          : undefined
      )
      console.error('Failed to delete customer:', message)
      toast.error(message)
    }
  }

  const handleRestore = async (customerId: number) => {
    try {
      await api.put(`/customers/${customerId}/`, { is_active: true })
      toast.success(tr('entityUpdated', { entity: ct('Customer') }) + ' — restored to active.')
      fetchCustomers()
    } catch (error: unknown) {
      const ax = error as { response?: { data?: unknown; status?: number; statusText?: string } }
      const message = formatJsonApiError(
        ax.response?.data,
        tr('failedUpdateEntity', { entity: ct('customer') }),
        ax.response
          ? { status: ax.response.status ?? 0, statusText: ax.response.statusText ?? '' }
          : undefined
      )
      toast.error(message)
    }
  }

  const resetForm = () => {
    setFormData({
      company_name: '',
      contact_person: '',
      email: '',
      phone: '',
      billing_address_line1: '',
      billing_city: '',
      billing_state: '',
      billing_country: '',
      bank_account_number: '',
      bank_name: '',
      bank_branch: '',
      bank_routing_number: '',
      opening_balance: 0,
      opening_balance_date: new Date().toISOString().split('T')[0],
      is_active: true,
      default_station_id: '',
    })
    setCustomerRefCode('')
    setEditingCustomer(null)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    resetForm()
  }

  const handleSort = (field: keyof Customer) => {
    setListPage(1)
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const totalCustomers = totalCount
  const activeCustomers = listStats?.active_count ?? 0
  const totalBalance = Number(listStats?.total_balance ?? 0)
  const totalReceivable = Number(listStats?.total_receivable ?? 0)

  const SortIcon = ({ field }: { field: keyof Customer }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-4 w-4 ml-1 text-muted-foreground/70" />
    }
    return sortDirection === 'asc' 
      ? <ArrowUp className="h-4 w-4 ml-1 text-primary" />
      : <ArrowDown className="h-4 w-4 ml-1 text-primary" />
  }

  const fetchCustomersForExport = async (): Promise<Customer[]> => {
    const res = await api.get('/customers/', {
      params: {
        paged: '1',
        skip: '0',
        limit: String(REFERENCE_FETCH_LIMIT),
        ...(debouncedSearch.trim() ? { q: debouncedSearch.trim() } : {}),
        sort: sortField || 'id',
        dir: sortDirection,
      },
    })
    const data = res.data
    if (isOffsetPagedPayload(data)) return data.results as Customer[]
    return Array.isArray(data) ? (data as Customer[]) : []
  }

  const exportSubtitle = () =>
    [
      debouncedSearch.trim() && tr('searchLabel', { q: debouncedSearch.trim() }),
      sortField && tr('sortLabel', { field: String(sortField), dir: sortDirection }),
      tr('generated', { date: formatDate(new Date(), true) }),
    ]
      .filter(Boolean)
      .join(' · ')

  const { handlePrint: handlePrintList, handleDownloadCsv: handleDownloadListCsv, handleDownloadJson: handleDownloadListJson } =
    usePagedListExport({
      fetchRows: fetchCustomersForExport,
      totalCount,
      labels: {
        entity: ct('customer'),
        entities: ct('customers'),
        emptyPrint: tr('noEntityPrint', { entities: ct('customers') }),
        emptyExport: tr('noEntityExport', { entities: ct('customers') }),
      },
      csvFilenamePrefix: 'customers',
      subtitle: exportSubtitle,
      printTitle: tr('entityList', { entity: ct('Customer') }),
      buildPrintContent: (rows, cappedTotal) =>
        buildContactListPrintHtml('customer', rows, currencySymbol, cappedTotal),
      buildCsv: buildCustomerListCsv,
    })

  return (
    <CompanyProvider>
      <PageLayout>
        <div className="app-scroll-pad">
          <ErpPageShell
            flush
            showBackLink={false}
            title={pageMeta.title}
            titleIcon={Users}
            description={pageMeta.description}
            maxWidthClass="max-w-[1600px]"
            contentClassName="mt-4"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <DocumentExportButtons
                  onPrint={() => void handlePrintList()}
                  onDownloadCsv={() => void handleDownloadListCsv()}
                  onDownloadJson={() => void handleDownloadListJson()}
                  printLabel={tr('printList')}
                />
                <button
                  onClick={() => setShowDebug(!showDebug)}
                  className="px-4 py-2 text-sm text-muted-foreground border border-border rounded-lg hover:bg-muted/40"
                  title={tr('toggleDebug')}
                >
                  {showDebug ? tr('hideDebug') : tr('showDebug')}
                </button>
              </div>
            }
          >
            {showDebug && (
              <div className="mb-6 p-4 bg-muted rounded-lg text-xs font-mono">
                <div className="mb-2"><strong>{tr('totalRows', { entity: ct('Customers') })}</strong> {totalCustomers}</div>
                <div className="mb-2"><strong>{tr('rowsThisPage')}</strong> {customers.length}</div>
                <div className="mb-2"><strong>{tr('apiResponse')}</strong> {apiResponse ? JSON.stringify(apiResponse, null, 2).substring(0, 500) : tr('notLoadedYet')}</div>
                <div><strong>{tr('firstRow', { entity: ct('Customer') })}</strong> {customers.length > 0 ? JSON.stringify(customers[0], null, 2).substring(0, 300) : tr('none')}</div>
              </div>
            )}

            {/* Statistics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <div className="bg-white rounded-lg shadow-sm p-6 border border-border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">{tr('totalCustomers')}</p>
                    <p className="text-2xl font-bold text-foreground">{totalCustomers}</p>
                  </div>
                  <div className="bg-blue-100 rounded-full p-3">
                    <Users className="h-6 w-6 text-primary" />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm p-6 border border-border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">{tr('activeCustomers')}</p>
                    <p className="text-2xl font-bold text-foreground">{activeCustomers}</p>
                  </div>
                  <div className="bg-success/15 rounded-full p-3">
                    <UserCheck className="h-6 w-6 text-success" />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm p-6 border border-border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">{tr('totalReceivables')}</p>
                    <p className="text-2xl font-bold text-foreground">
                      {currencySymbol}{formatNumber(totalReceivable)}
                    </p>
                  </div>
                  <div className="bg-amber-100 rounded-full p-3">
                    <DollarSign className="h-6 w-6 text-amber-600" />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm p-6 border border-border">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground mb-1">{tr('netBalance')}</p>
                    <p className={`text-2xl font-bold ${totalBalance >= 0 ? 'text-foreground' : 'text-destructive'}`}>
                      {currencySymbol}{formatNumber(Math.abs(totalBalance))}
                    </p>
                  </div>
                  <div className={`rounded-full p-3 ${totalBalance >= 0 ? 'bg-muted' : 'bg-destructive/10'}`}>
                    <DollarSign className={`h-6 w-6 ${totalBalance >= 0 ? 'text-muted-foreground' : 'text-destructive'}`} />
                  </div>
                </div>
              </div>
            </div>

            {/* Search and Actions Bar */}
            <div className="bg-white rounded-lg shadow-sm p-4 mb-6 border border-border">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="relative flex-1 w-full sm:max-w-md">
                  <Search className="erp-search-icon" />
                  <input
                    type="text"
                    placeholder={ct('searchCustomers')}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                  />
                </div>
                <label className="inline-flex items-center gap-2 shrink-0 text-sm text-foreground/85">
                  <input
                    type="checkbox"
                    checked={includeInactive}
                    onChange={(e) => {
                      setIncludeInactive(e.target.checked)
                      setListPage(1)
                    }}
                    className="h-4 w-4 rounded border-border text-primary"
                  />
                  Include inactive
                </label>
                <div className="flex items-center gap-3">
                  {totalCustomers === 0 && (
                    <button
                      onClick={handleAddDummyCustomers}
                      disabled={addingDummy}
                      className="flex items-center space-x-2 px-5 py-2.5 bg-success text-white rounded-lg hover:bg-success/90 transition-colors shadow-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      title={ct('addDummyTitle')}
                    >
                      {addingDummy ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          <span>{tr('adding')}</span>
                        </>
                      ) : (
                        <>
                          <Users className="h-4 w-4" />
                          <span>{ct('addDummyCustomers')}</span>
                        </>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      resetForm()
                      setCreateCodeNonce((n) => n + 1)
                      setShowModal(true)
                    }}
                    className="flex items-center space-x-2 px-6 py-2.5 bg-primary text-white rounded-lg hover:bg-primary transition-colors shadow-sm font-medium"
                  >
                    <Plus className="h-5 w-5" />
                    <span>{tr('addEntity', { entity: ct('Customer') })}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Content */}
            {loading ? (
              <div className="space-y-4">
                {/* Loading Skeleton */}
                <div className="bg-white rounded-lg shadow-sm border border-border p-6">
                  <div className="animate-pulse space-y-4">
                    <div className="h-4 bg-muted rounded w-3/4"></div>
                    <div className="h-4 bg-muted rounded w-1/2"></div>
                    <div className="h-4 bg-muted rounded w-5/6"></div>
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-border overflow-hidden">
                  <div className="animate-pulse">
                    <div className="h-12 bg-muted"></div>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className="h-16 border-b border-border bg-white"></div>
                    ))}
                  </div>
                </div>
              </div>
            ) : error ? (
              <div className="bg-destructive/5 border border-destructive/25 rounded-lg p-4 sm:p-6 md:p-8">
                <div className="text-center mb-6">
                  <AlertTriangle className="h-16 w-16 text-destructive mx-auto mb-4" />
                  <h3 className="text-xl font-bold text-destructive mb-2">{tr('backendConnectionError')}</h3>
                  <p className="text-destructive whitespace-pre-line text-left max-w-2xl mx-auto mb-6">{error}</p>
                </div>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <button
                    onClick={fetchCustomers}
                    className="inline-flex items-center space-x-2 px-6 py-3 bg-destructive text-white rounded-lg hover:bg-destructive/90 transition-colors font-medium"
                  >
                    <RefreshCw className="h-5 w-5" />
                    <span>{tr('retryConnection')}</span>
                  </button>
                  <a
                    href={apiDocsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center space-x-2 px-6 py-3 border border-destructive/30 text-destructive rounded-lg hover:bg-destructive/10 transition-colors font-medium"
                  >
                    <span>{tr('checkBackendStatus')}</span>
                  </a>
                </div>
                <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-left max-w-2xl mx-auto">
                  <p className="text-sm text-yellow-800 font-semibold mb-2">{tr('troubleshootingTitle')}</p>
                  <ol className="text-sm text-yellow-700 list-decimal list-inside space-y-1">
                    <li>{tr('troubleshootApiDocs', { url: apiDocsUrl })}</li>
                    <li>{tr('troubleshootConsole')}</li>
                    <li>{tr('troubleshootRestart')}</li>
                    <li>{tr('troubleshootDb')}</li>
                  </ol>
                </div>
              </div>
            ) : customers.length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm p-12 text-center border border-border">
                <Users className="h-16 w-16 text-muted-foreground/70 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  {debouncedSearch.trim()
                    ? tr('noEntityFound', { entities: ct('customers') })
                    : totalCustomers === 0
                      ? tr('noEntityInDb', { entities: ct('customers') })
                      : tr('noEntityToShow', { entities: ct('customers') })}
                </h3>
                <p className="text-muted-foreground mb-6">
                  {debouncedSearch.trim()
                    ? tr('tryAdjustSearch')
                    : totalCustomers === 0
                      ? tr('emptyDbHint', { entities: ct('customers'), entity: ct('customer') })
                      : tr('getStartedAdd', { entity: ct('customer') })}
                </p>
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  {!debouncedSearch.trim() && totalCustomers === 0 && (
                    <button
                      onClick={handleAddDummyCustomers}
                      disabled={addingDummy}
                      className="inline-flex items-center space-x-2 px-6 py-3 bg-success text-white rounded-lg hover:bg-success/90 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                    >
                      {addingDummy ? (
                        <>
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                          <span>{ct('addingDummyCustomers')}</span>
                        </>
                      ) : (
                        <>
                          <Users className="h-5 w-5" />
                          <span>{ct('addDummyCustomersCount')}</span>
                        </>
                      )}
                    </button>
                  )}
                  {!debouncedSearch.trim() && (
                    <button
                      onClick={() => {
                        resetForm()
                        setCreateCodeNonce((n) => n + 1)
                        setShowModal(true)
                      }}
                      className="inline-flex items-center space-x-2 px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary transition-colors font-medium"
                    >
                      <Plus className="h-5 w-5" />
                      <span>{totalCustomers === 0 ? tr('addYourFirst', { entity: ct('Customer') }) : tr('addNew', { entity: ct('Customer') })}</span>
                    </button>
                  )}
                  <button
                    onClick={fetchCustomers}
                    className="inline-flex items-center space-x-2 px-6 py-3 border border-border text-foreground/85 rounded-lg hover:bg-muted/40 transition-colors font-medium"
                  >
                    <RefreshCw className="h-5 w-5" />
                    <span>{t('refresh')}</span>
                  </button>
                </div>
                {totalCustomers === 0 && (
                  <div className="mt-6 p-4 bg-blue-50 border border-primary/25 rounded-lg text-left max-w-2xl mx-auto">
                    <p className="text-sm text-primary mb-2">
                      <strong>{ct('quickStartTitle')}</strong>
                    </p>
                    <ul className="text-sm text-primary list-disc list-inside space-y-1">
                      <li>{ct('quickStartCash')}</li>
                      <li>{ct('quickStartCredit')}</li>
                    </ul>
                    <p className="text-xs text-primary mt-3">
                      {ct('quickStartDemo')}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-sm overflow-hidden border border-border">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-border">
                    <thead className="bg-muted/40">
                      <tr>
                        <th 
                          className="px-6 py-4 text-left text-xs font-semibold text-foreground/85 uppercase tracking-wider cursor-pointer hover:bg-muted transition-colors"
                          onClick={() => handleSort('customer_number')}
                        >
                          <div className="flex items-center">
                            {tr('customerHash')}
                            <SortIcon field="customer_number" />
                          </div>
                        </th>
                        <th 
                          className="px-6 py-4 text-left text-xs font-semibold text-foreground/85 uppercase tracking-wider cursor-pointer hover:bg-muted transition-colors"
                          onClick={() => handleSort('display_name')}
                        >
                          <div className="flex items-center">
                            {t('name')}
                            <SortIcon field="display_name" />
                          </div>
                        </th>
                        <th
                          className="px-6 py-4 text-left text-xs font-semibold text-foreground/85 uppercase tracking-wider hidden md:table-cell"
                          onClick={() => handleSort('default_station_name' as keyof Customer)}
                        >
                          <div className="flex items-center">
                            <Building2 className="h-3.5 w-3.5 mr-1 text-amber-600/90 shrink-0" />
                            {tr('defaultSite')}
                            <SortIcon field={'default_station_name' as keyof Customer} />
                          </div>
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-foreground/85 uppercase tracking-wider">
                          {tr('contact')}
                        </th>
                        <th 
                          className="px-6 py-4 text-right text-xs font-semibold text-foreground/85 uppercase tracking-wider cursor-pointer hover:bg-muted transition-colors"
                          onClick={() => handleSort('current_balance')}
                        >
                          <div className="flex items-center justify-end">
                            {tr('balance')}
                            <SortIcon field="current_balance" />
                          </div>
                        </th>
                        <th 
                          className="px-6 py-4 text-center text-xs font-semibold text-foreground/85 uppercase tracking-wider cursor-pointer hover:bg-muted transition-colors"
                          onClick={() => handleSort('is_active')}
                        >
                          <div className="flex items-center justify-center">
                            {t('status')}
                            <SortIcon field="is_active" />
                          </div>
                        </th>
                        <th className="px-6 py-4 text-right text-xs font-semibold text-foreground/85 uppercase tracking-wider">
                          {t('actions')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-border">
                      {customers.map((customer) => {
                        const balance = Number(customer.current_balance || 0)
                        return (
                          <tr key={customer.id} className="hover:bg-muted/40 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="text-sm font-medium text-foreground">
                                {customer.customer_number}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="text-sm font-medium text-foreground">
                                {customer.display_name || '-'}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-sm text-foreground/85 max-w-[11rem] hidden md:table-cell">
                              <span className="inline-flex items-center gap-1.5">
                                <Building2 className="h-3.5 w-3.5 text-amber-600/80 shrink-0" />
                                <span
                                  className="truncate"
                                  title={customer.default_station_name || undefined}
                                >
                                  {(customer.default_station_name || '').trim() || '—'}
                                </span>
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="space-y-1">
                                {customer.email && (
                                  <div className="flex items-center text-sm text-muted-foreground">
                                    <Mail className="h-3.5 w-3.5 mr-1.5 text-muted-foreground/70" />
                                    <span>{customer.email}</span>
                                  </div>
                                )}
                                {customer.phone && (
                                  <div className="flex items-center text-sm text-muted-foreground">
                                    <Phone className="h-3.5 w-3.5 mr-1.5 text-muted-foreground/70" />
                                    <span>{customer.phone}</span>
                                  </div>
                                )}
                                {!customer.email && !customer.phone && (
                                  <span className="text-sm text-muted-foreground/70">-</span>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right">
                              <span className={`text-sm font-semibold ${
                                balance > 0 
                                  ? 'text-amber-600' 
                                  : balance < 0 
                                  ? 'text-success' 
                                  : 'text-foreground'
                              }`}>
                                {balance > 0 ? '+' : ''}{currencySymbol}{formatNumber(Math.abs(balance))}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center">
                              <span className={`inline-flex px-3 py-1 text-xs font-semibold rounded-full ${
                                customer.is_active 
                                  ? 'bg-success/15 text-success' 
                                  : 'bg-destructive/10 text-destructive'
                              }`}>
                                {customer.is_active ? t('active') : t('inactive')}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                              <div className="flex items-center justify-end space-x-3">
                                <Link
                                  href={`/customers/${customer.id}/ledger`}
                                  className="text-emerald-600 hover:text-emerald-900 transition-colors"
                                  title={tr('viewLedger', { entity: ct('Customer') })}
                                >
                                  <BookOpen className="h-4 w-4" />
                                </Link>
                                <button 
                                  onClick={() => handleEdit(customer)}
                                  className="text-primary hover:text-blue-900 transition-colors"
                                  title={tr('editTitle', { entity: ct('customer') })}
                                >
                                  <Edit className="h-4 w-4" />
                                </button>
                                {customer.is_active ? (
                                  <button 
                                    onClick={() => setShowDeleteConfirm(customer.id)}
                                    className="text-destructive hover:text-red-900 transition-colors"
                                    title={tr('deleteTitle', { entity: ct('customer') })}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleRestore(customer.id)}
                                    className="text-emerald-600 hover:text-emerald-900 transition-colors"
                                    title="Restore customer"
                                  >
                                    <Undo2 className="h-4 w-4" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {totalCount > 0 && (
                  <div className="space-y-3 bg-muted/40 px-6 py-4 border-t border-border">
                    <OffsetPaginationControls
                      page={listPage}
                      pageSize={pageSize}
                      total={totalCount}
                      disabled={loading}
                      onPageChange={setListPage}
                      onPageSizeChange={(n) => {
                        setPageSize(n)
                        setListPage(1)
                      }}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      {sortField && (
                        <p className="text-xs text-muted-foreground">
                          {tr('sortedBy', {
                            field: String(sortField).replace('_', ' '),
                            dir: sortDirection === 'asc' ? tr('ascending') : tr('descending'),
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Delete Confirmation Modal */}
            {showDeleteConfirm && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-xl">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-foreground">{tr('deleteEntity', { entity: ct('Customer') })}</h2>
                    <button
                      onClick={() => setShowDeleteConfirm(null)}
                      className="text-muted-foreground/70 hover:text-muted-foreground transition-colors"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <p className="text-muted-foreground mb-6">
                    {tr('deleteCustomerBody')} Enable &quot;Include inactive&quot; to find and restore this customer later.
                  </p>
                  <div className="flex justify-end space-x-3">
                    <button
                      onClick={() => setShowDeleteConfirm(null)}
                      className="px-4 py-2 border border-border rounded-lg hover:bg-muted/40 transition-colors font-medium"
                    >
                      {t('cancel')}
                    </button>
                    <button
                      onClick={() => handleDelete(showDeleteConfirm)}
                      className="px-4 py-2 bg-destructive text-white rounded-lg hover:bg-destructive/90 transition-colors font-medium"
                    >
                      {t('delete')}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Create/Edit Modal */}
            {showModal && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
                <div className="bg-white rounded-lg app-modal-pad max-w-[1440px] w-full max-h-[96vh] overflow-y-auto shadow-xl my-8">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-foreground">
                      {editingCustomer ? tr('editEntity', { entity: ct('Customer') }) : tr('addNewEntity', { entity: ct('Customer') })}
                    </h2>
                    <button
                      onClick={handleCloseModal}
                      className="text-muted-foreground/70 hover:text-muted-foreground transition-colors"
                    >
                      <X className="h-6 w-6" />
                    </button>
                  </div>
                  <form onSubmit={editingCustomer ? handleUpdate : handleCreate}>
                    {editingCustomer ? (
                      <ReferenceCodePicker
                        kind="customer"
                        id="customer_ref_code_ro"
                        label={ct('customerNumber')}
                        value={editingCustomer.customer_number || ''}
                        onChange={() => {}}
                        disabled
                        className="mb-6"
                      />
                    ) : (
                      <ReferenceCodePicker
                        key={createCodeNonce}
                        kind="customer"
                        id="customer_ref_code"
                        label={ct('customerNumber')}
                        value={customerRefCode}
                        onChange={setCustomerRefCode}
                        className="mb-6"
                      />
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-foreground">
                          {tr('companyName')}
                        </label>
                        <input
                          type="text"
                          value={formData.company_name}
                          onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                          className="w-full px-4 py-2.5 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                          placeholder={ct('enterCompanyName')}
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-foreground">
                          {tr('contactPerson')}
                        </label>
                        <input
                          type="text"
                          value={formData.contact_person}
                          onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
                          className="w-full px-4 py-2.5 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                          placeholder={ct('enterContactPerson')}
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-foreground">{tr('email')}</label>
                        <input
                          type="email"
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          className="w-full px-4 py-2.5 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                          placeholder={ct('emailPlaceholder')}
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-foreground">{tr('phone')}</label>
                        <input
                          type="text"
                          value={formData.phone}
                          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                          className="w-full px-4 py-2.5 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                          placeholder={ct('phonePlaceholder')}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-foreground/85 mb-2 inline-flex items-center gap-1.5">
                          <Building2 className="h-4 w-4 text-amber-600" />
                          {tr('defaultSite')}
                        </label>
                        <select
                          value={formData.default_station_id === '' ? '' : String(formData.default_station_id)}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              default_station_id: e.target.value === '' ? '' : e.target.value,
                            })
                          }
                          className="w-full px-4 py-2.5 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring bg-white"
                        >
                          <option value="">{tr('notSet')}</option>
                          {stations.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.station_name}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {ct('defaultSiteHint')}
                        </p>
                      </div>
                      <div className="md:col-span-2">
                        <p className="text-sm font-semibold text-foreground mb-3">{tr('bankDetailsOptional')}</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="mb-2 block text-sm font-medium text-foreground">
                              {tr('accountNumber')}
                            </label>
                            <input
                              type="text"
                              value={formData.bank_account_number}
                              onChange={(e) =>
                                setFormData({ ...formData, bank_account_number: e.target.value })
                              }
                              className="w-full px-4 py-2.5 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                              autoComplete="off"
                            />
                          </div>
                          <div>
                            <label className="mb-2 block text-sm font-medium text-foreground">
                              {tr('bankName')}
                            </label>
                            <input
                              type="text"
                              value={formData.bank_name}
                              onChange={(e) =>
                                setFormData({ ...formData, bank_name: e.target.value })
                              }
                              className="w-full px-4 py-2.5 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                            />
                          </div>
                          <div>
                            <label className="mb-2 block text-sm font-medium text-foreground">
                              {tr('branch')}
                            </label>
                            <input
                              type="text"
                              value={formData.bank_branch}
                              onChange={(e) =>
                                setFormData({ ...formData, bank_branch: e.target.value })
                              }
                              className="w-full px-4 py-2.5 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                            />
                          </div>
                          <div>
                            <label className="mb-2 block text-sm font-medium text-foreground">
                              {tr('routingNumber')}
                            </label>
                            <input
                              type="text"
                              value={formData.bank_routing_number}
                              onChange={(e) =>
                                setFormData({ ...formData, bank_routing_number: e.target.value })
                              }
                              className="w-full px-4 py-2.5 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                              placeholder={tr('routingPlaceholder')}
                            />
                          </div>
                        </div>
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-foreground">
                          {tr('openingBalance', { sym: currencySymbol })}
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={formData.opening_balance}
                          onChange={(e) => setFormData({ ...formData, opening_balance: parseFloat(e.target.value) || 0 })}
                          className="w-full px-4 py-2.5 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring"
                          placeholder="0.00"
                        />
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {editingCustomer ? ct('openingBalanceHintEdit') : ct('openingBalanceHintCreate')}
                        </p>
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-foreground">
                          {tr('asOfDate')}
                        </label>
                        <CompanyDateInput value={formData.opening_balance_date} onChange={(iso) => setFormData({ ...formData, opening_balance_date: iso })} className="w-full px-4 py-2.5 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring" />
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          {ct('openingBalanceDateHint')}
                        </p>
                      </div>
                      <div className="md:col-span-2">
                        <label className="flex items-center space-x-3">
                          <input
                            type="checkbox"
                            checked={formData.is_active}
                            onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                            className="w-5 h-5 text-primary border-border rounded focus:ring-ring"
                          />
                          <span className="text-sm font-medium text-foreground/85">{ct('activeCustomer')}</span>
                        </label>
                      </div>
                    </div>
                    <div className="flex justify-end space-x-3 pt-6 border-t border-border">
                      <button
                        type="button"
                        onClick={handleCloseModal}
                        className="px-6 py-2.5 border border-border rounded-lg hover:bg-muted/40 transition-colors font-medium"
                      >
                        {t('cancel')}
                      </button>
                      <button
                        type="submit"
                        className="px-6 py-2.5 bg-primary text-white rounded-lg hover:bg-primary transition-colors font-medium shadow-sm"
                      >
                        {editingCustomer ? tr('updateEntity', { entity: ct('Customer') }) : tr('createEntity', { entity: ct('Customer') })}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </ErpPageShell>
        </div>
      </PageLayout>
    </CompanyProvider>
  )
}
