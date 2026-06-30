'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { AQ_HERO_BTN_PRIMARY } from '@/components/aquaculture/AquacultureUi'
import { CompanyProvider } from '@/contexts/CompanyContext'
import {
  Plus,
  Edit,
  Trash2,
  Undo2,
  Search,
  AlertTriangle,
  RefreshCw,
  BookOpen,
  Building2,
  MapPin,
  Info,
} from 'lucide-react'
import { vendorUsualReceivingLabel } from '@/lib/vendorReceivingDefaults'
import { VendorDefaultReceivingSelect } from '@/components/vendors/VendorDefaultReceivingSelect'
import { DocumentExportButtons } from '@/components/DocumentExportButtons'
import { useToast } from '@/components/Toast'
import { usePageMeta } from '@/hooks/usePageMeta'
import { useT } from '@/lib/i18n'
import { useErpCommonT } from '@/lib/moduleI18n/erpCommon'
import { useContactsT } from '@/lib/moduleI18n/contacts'
import api, { getBackendOrigin } from '@/lib/api'
import { isOffsetPagedPayload, offsetListParams, REFERENCE_FETCH_LIMIT } from '@/lib/pagination'
import { OffsetPaginationControls } from '@/components/ui/OffsetPaginationControls'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { extractErrorMessage } from '@/utils/errorHandler'
import { isConnectionError } from '@/utils/connectionError'
import { ReferenceCodePicker } from '@/components/ReferenceCodePicker'
import { CoaAccountCombobox } from '@/components/reference/CoaAccountCombobox'
import { formatDate } from '@/utils/date'
import {
  buildVendorListCsv,
  type VendorContactExport,
} from '@/utils/businessDocumentExport'
import { buildContactListPrintHtml } from '@/utils/listExportHelpers'
import { usePagedListExport } from '@/hooks/usePagedListExport'
import {
  suggestVendorDefaultExpenseAccountId,
  templateVendorDefaultExpenseOptionLabel,
} from '@/lib/vendorDefaults'
import {
  mergeSuggestedStringField,
  syncBooleanFieldTouchedForAccountPick,
} from '@/lib/coaSuggestForm'

interface Vendor {
  id: number
  vendor_number: string
  company_name: string
  display_name: string
  email: string
  phone: string
  current_balance: number
  is_active: boolean
  contact_person?: string | null
  billing_address_line1?: string | null
  opening_balance?: number | string
  opening_balance_date?: string | null
  bank_account_number?: string | null
  bank_name?: string | null
  bank_branch?: string | null
  bank_routing_number?: string | null
  /** Usual receiving site; new bills default here */
  default_station_id?: number | null
  default_station_name?: string | null
  default_aquaculture_pond_id?: number | null
  default_aquaculture_pond_name?: string | null
  default_expense_account_id?: number | null
  default_expense_account_code?: string | null
  default_expense_account_name?: string | null
}

interface StationOption {
  id: number
  station_name: string
  is_active?: boolean
  operates_fuel_retail?: boolean
}

interface PondOption {
  id: number
  name: string
  code?: string
  is_active?: boolean
}

interface CoaPickRow {
  id: number
  account_code: string
  account_name: string
  account_type: string
}

export default function VendorsPage() {
  const router = useRouter()
  const toast = useToast()
  const pageMeta = usePageMeta()
  const { t } = useT()
  const tr = useErpCommonT()
  const ct = useContactsT()
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null)
  const [currencySymbol, setCurrencySymbol] = useState<string>('৳') // Default to BDT
  const [vendorRefCode, setVendorRefCode] = useState('')
  const [createCodeNonce, setCreateCodeNonce] = useState(0)
  const [stations, setStations] = useState<StationOption[]>([])
  const [ponds, setPonds] = useState<PondOption[]>([])
  const [coaExpenseOptions, setCoaExpenseOptions] = useState<CoaPickRow[]>([])
  /** User picked a custom expense account — do not overwrite when receiving location changes. */
  const vendorExpenseAccountTouchedRef = useRef(false)
  const [listPage, setListPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [totalCount, setTotalCount] = useState(0)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [formData, setFormData] = useState({
    company_name: '',
    contact_person: '',
    email: '',
    phone: '',
    billing_address_line1: '',
    bank_account_number: '',
    bank_name: '',
    bank_branch: '',
    bank_routing_number: '',
    opening_balance: 0,
    opening_balance_date: new Date().toISOString().split('T')[0],
    is_active: true,
    /** '' | `s:${stationId}` | `p:${pondId}` — default receiving location for bills */
    default_receiving: '' as string,
    default_expense_account_id: '' as string,
  })

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    fetchStationsList()
    fetchPondsList()
  }, [router])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchTerm), 350)
    return () => clearTimeout(t)
  }, [searchTerm])

  useEffect(() => {
    setListPage(1)
  }, [debouncedSearch, pageSize])

  const fetchPondsList = async () => {
    try {
      const res = await api.get<unknown[]>('/aquaculture/ponds/', { timeout: 8000 })
      const rows = Array.isArray(res.data) ? res.data : []
      const parsed: PondOption[] = []
      for (const r of rows) {
        const o = r as { id?: number; name?: string; code?: string; is_active?: boolean }
        if (typeof o.id !== 'number') continue
        if (o.is_active === false) continue
        parsed.push({
          id: o.id,
          name: (o.name || '').trim() || `Pond #${o.id}`,
          code: (o.code || '').trim(),
        })
      }
      setPonds(parsed)
    } catch {
      setPonds([])
    }
  }

  const fetchStationsList = async () => {
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
        }
        if (typeof o.id !== 'number') continue
        if (o.is_active === false) continue
        parsed.push({
          id: o.id,
          station_name: o.station_name || `Site #${o.id}`,
          is_active: o.is_active,
          operates_fuel_retail: o.operates_fuel_retail === false ? false : true,
        })
      }
      setStations(parsed)
    } catch {
      setStations([])
    }
  }

  const loadExpenseCoa = useCallback(async () => {
    try {
      const token = localStorage.getItem('access_token')
      if (!token) return
      const r = await api.get('/chart-of-accounts/', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const rows = Array.isArray(r.data) ? r.data : []
      setCoaExpenseOptions(
        rows
          .filter((x: { is_active?: boolean }) => x.is_active !== false)
          .map((x: { id: number; account_code?: string; account_name?: string; account_type?: string }) => ({
            id: x.id,
            account_code: String(x.account_code || ''),
            account_name: String(x.account_name || ''),
            account_type: String(x.account_type || ''),
          }))
          .filter((x) => x.account_type.toLowerCase() === 'expense')
      )
    } catch {
      setCoaExpenseOptions([])
    }
  }, [])

  useEffect(() => {
    if (showModal) void loadExpenseCoa()
  }, [showModal, loadExpenseCoa])

  /** Active suggest: pre-fill expense when usual location is set (editable via dropdown). */
  useEffect(() => {
    if (!showModal || vendorExpenseAccountTouchedRef.current || !formData.default_receiving) {
      return
    }
    if (String(formData.default_expense_account_id || '').trim() !== '') {
      return
    }
    const suggested = suggestVendorDefaultExpenseAccountId(
      formData.default_receiving,
      coaExpenseOptions
    )
    if (!suggested) return
    setFormData((prev) => ({ ...prev, default_expense_account_id: suggested }))
  }, [
    showModal,
    formData.default_receiving,
    formData.default_expense_account_id,
    coaExpenseOptions,
  ])

  const fetchVendors = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      try {
        const companyRes = await api.get('/companies/current')
        if (companyRes.data?.currency) {
          setCurrencySymbol(getCurrencySymbol(companyRes.data.currency))
        }
      } catch (error) {
        if (!isConnectionError(error)) {
          console.error('Error fetching company currency:', error)
        }
      }

      const params = offsetListParams({
        page: listPage,
        pageSize,
        q: debouncedSearch,
        sort: 'id',
        dir: 'asc',
        extra: { include_inactive: includeInactive ? 'true' : undefined },
      })
      const response = await api.get('/vendors/', { params })
      if (response.status === 401 || response.status === 403) {
        localStorage.removeItem('access_token')
        router.push('/login')
        return
      }
      if (response.status !== 200) {
        const errorMsg = `Failed to load vendors: ${response.status}`
        setError(errorMsg)
        toast.error(errorMsg)
        return
      }
      const data = response.data
      if (isOffsetPagedPayload(data)) {
        setVendors(data.results as Vendor[])
        setTotalCount(data.count)
        const totalPages = Math.max(1, Math.ceil(data.count / pageSize))
        if (listPage > totalPages) {
          setListPage(totalPages)
        }
        setError(null)
      } else {
        setError('Invalid data format received from server')
        setVendors([])
        setTotalCount(0)
        toast.error('Invalid data format received from server')
      }
    } catch (error) {
      console.error('Error fetching vendors:', error)
      const errorMessage = extractErrorMessage(error, 'Failed to load vendors')
      let userMessage = 'Error connecting to server'

      if (errorMessage.includes('fetch') || errorMessage.includes('Failed to fetch')) {
        userMessage = `Cannot connect to backend server. Please ensure the backend is running on ${getBackendOrigin()}`
      } else {
        userMessage = errorMessage
      }

      setError(userMessage)
      toast.error(userMessage)
      setVendors([])
      setTotalCount(0)
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, includeInactive, listPage, pageSize, router, toast])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) return
    void fetchVendors()
  }, [fetchVendors])

  const parseDefaultReceivingPayload = (): {
    default_station_id: number | null
    default_aquaculture_pond_id: number | null
  } => {
    const dr = formData.default_receiving
    if (dr.startsWith('p:')) {
      const id = parseInt(dr.slice(2), 10)
      return {
        default_station_id: null,
        default_aquaculture_pond_id: Number.isFinite(id) ? id : null,
      }
    }
    if (dr.startsWith('s:')) {
      const id = parseInt(dr.slice(2), 10)
      return {
        default_station_id: Number.isFinite(id) ? id : null,
        default_aquaculture_pond_id: null,
      }
    }
    return { default_station_id: null, default_aquaculture_pond_id: null }
  }

  const parseDefaultExpenseAccountIdPayload = (): number | null => {
    const s = String(formData.default_expense_account_id || '').trim()
    if (!s) return null
    const n = parseInt(s, 10)
    return Number.isFinite(n) && n > 0 ? n : null
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const { default_station_id, default_aquaculture_pond_id } = parseDefaultReceivingPayload()
      await api.post('/vendors/', {
        company_name: formData.company_name || null,
        contact_person: formData.contact_person || '',
        display_name: formData.company_name || formData.contact_person || '',
        email: formData.email || null,
        phone: formData.phone || null,
        billing_address_line1: formData.billing_address_line1 || '',
        bank_account_number: formData.bank_account_number || '',
        bank_name: formData.bank_name || '',
        bank_branch: formData.bank_branch || '',
        bank_routing_number: formData.bank_routing_number || '',
        opening_balance: formData.opening_balance,
        opening_balance_date: formData.opening_balance_date || null,
        is_active: formData.is_active,
        default_station_id,
        default_aquaculture_pond_id,
        default_expense_account_id: parseDefaultExpenseAccountIdPayload(),
        ...(vendorRefCode.trim() ? { vendor_number: vendorRefCode.trim() } : {}),
      })
      toast.success(tr('entityCreated', { entity: ct('Vendor') }))
      setShowModal(false)
      fetchVendors()
      resetForm()
    } catch (error) {
      console.error('Error creating vendor:', error)
      const errorMessage = extractErrorMessage(error, tr('failedCreateEntity', { entity: ct('vendor') }))
      toast.error(errorMessage)
    }
  }

  const handleEdit = (vendor: Vendor) => {
    vendorExpenseAccountTouchedRef.current =
      vendor.default_expense_account_id != null && vendor.default_expense_account_id > 0
    setEditingVendor(vendor)
    setFormData({
      company_name: vendor.company_name || '',
      contact_person: vendor.contact_person || '',
      email: vendor.email || '',
      phone: vendor.phone || '',
      billing_address_line1: vendor.billing_address_line1 || '',
      bank_account_number: vendor.bank_account_number || '',
      bank_name: vendor.bank_name || '',
      bank_branch: vendor.bank_branch || '',
      bank_routing_number: vendor.bank_routing_number || '',
      opening_balance: Number(vendor.opening_balance ?? vendor.current_balance ?? 0),
      opening_balance_date: vendor.opening_balance_date
        ? new Date(vendor.opening_balance_date).toISOString().split('T')[0]
        : new Date().toISOString().split('T')[0],
      is_active: vendor.is_active,
      default_receiving:
        vendor.default_aquaculture_pond_id != null && vendor.default_aquaculture_pond_id > 0
          ? `p:${vendor.default_aquaculture_pond_id}`
          : vendor.default_station_id != null && vendor.default_station_id > 0
            ? `s:${vendor.default_station_id}`
            : '',
      default_expense_account_id:
        vendor.default_expense_account_id != null && vendor.default_expense_account_id > 0
          ? String(vendor.default_expense_account_id)
          : '',
    })
    setShowModal(true)
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingVendor) return

    try {
      const { default_station_id, default_aquaculture_pond_id } = parseDefaultReceivingPayload()
      await api.put(`/vendors/${editingVendor.id}/`, {
        company_name: formData.company_name || null,
        contact_person: formData.contact_person || '',
        display_name: formData.company_name || formData.contact_person || '',
        email: formData.email || null,
        phone: formData.phone || null,
        billing_address_line1: formData.billing_address_line1 || '',
        bank_account_number: formData.bank_account_number || '',
        bank_name: formData.bank_name || '',
        bank_branch: formData.bank_branch || '',
        bank_routing_number: formData.bank_routing_number || '',
        is_active: formData.is_active,
        opening_balance: formData.opening_balance,
        opening_balance_date: formData.opening_balance_date || null,
        default_station_id,
        default_aquaculture_pond_id,
        default_expense_account_id: parseDefaultExpenseAccountIdPayload(),
      })
      toast.success(tr('entityUpdated', { entity: ct('Vendor') }))
      setShowModal(false)
      setEditingVendor(null)
      fetchVendors()
      resetForm()
    } catch (error) {
      console.error('Error updating vendor:', error)
      const errorMessage = extractErrorMessage(error, tr('failedUpdateEntity', { entity: ct('vendor') }))
      toast.error(errorMessage)
    }
  }

  const handleDelete = async (vendorId: number) => {
    try {
      await api.delete(`/vendors/${vendorId}/`)
      toast.success(tr('entityDeleted', { entity: ct('Vendor') }) + ' You can restore inactive vendors when needed.')
      setShowDeleteConfirm(null)
      fetchVendors()
    } catch (error) {
      console.error('Error deleting vendor:', error)
      const errorMessage = extractErrorMessage(error, tr('failedDeleteEntity', { entity: ct('vendor') }))
      toast.error(errorMessage)
    }
  }

  const handleRestore = async (vendorId: number) => {
    try {
      await api.put(`/vendors/${vendorId}/`, { is_active: true })
      toast.success(tr('entityUpdated', { entity: ct('Vendor') }) + ' — restored to active.')
      fetchVendors()
    } catch (error) {
      console.error('Error restoring vendor:', error)
      const errorMessage = extractErrorMessage(error, tr('failedUpdateEntity', { entity: ct('vendor') }))
      toast.error(errorMessage)
    }
  }

  const resetForm = () => {
    vendorExpenseAccountTouchedRef.current = false
    setFormData({
      company_name: '',
      contact_person: '',
      email: '',
      phone: '',
      billing_address_line1: '',
      bank_account_number: '',
      bank_name: '',
      bank_branch: '',
      bank_routing_number: '',
      opening_balance: 0,
      opening_balance_date: new Date().toISOString().split('T')[0],
      is_active: true,
      default_receiving: '',
      default_expense_account_id: '',
    })
    setVendorRefCode('')
    setEditingVendor(null)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    resetForm()
  }


  const defaultReceivingLabel = (vendor: Vendor) => {
    const label = vendorUsualReceivingLabel(vendor)
    return label || '—'
  }

  const fetchVendorsForExport = async (): Promise<Vendor[]> => {
    const res = await api.get('/vendors/', {
      params: {
        paged: '1',
        skip: '0',
        limit: String(REFERENCE_FETCH_LIMIT),
        ...(debouncedSearch.trim() ? { q: debouncedSearch.trim() } : {}),
        sort: 'id',
        dir: 'asc',
      },
    })
    const data = res.data
    if (isOffsetPagedPayload(data)) return data.results as Vendor[]
    return Array.isArray(data) ? (data as Vendor[]) : []
  }

  const vendorsAsExport = (rows: Vendor[]): VendorContactExport[] =>
    rows.map((v) => ({
      vendor_number: v.vendor_number,
      company_name: v.company_name,
      display_name: v.display_name,
      usual_location: defaultReceivingLabel(v),
      email: v.email,
      phone: v.phone,
      current_balance: v.current_balance,
      is_active: v.is_active,
    }))

  const exportSubtitle = () =>
    [
      debouncedSearch.trim() && `Search: ${debouncedSearch.trim()}`,
      `Generated ${formatDate(new Date(), true)}`,
    ]
      .filter(Boolean)
      .join(' · ')

  const { handlePrint: handlePrintList, handleDownloadCsv: handleDownloadListCsv, handleDownloadJson: handleDownloadListJson } =
    usePagedListExport({
      fetchRows: fetchVendorsForExport,
      totalCount,
      labels: {
        entity: 'vendor',
        entities: 'vendors',
        emptyPrint: 'No vendors to print for the current filter.',
        emptyExport: 'No vendors to export.',
      },
      csvFilenamePrefix: 'vendors',
      subtitle: exportSubtitle,
      printTitle: 'Vendor list',
      buildPrintContent: (rows, cappedTotal) =>
        buildContactListPrintHtml('vendor', vendorsAsExport(rows), currencySymbol, cappedTotal),
      buildCsv: (rows) => buildVendorListCsv(vendorsAsExport(rows)),
    })

  return (
    <CompanyProvider>
      <PageLayout>
        <ErpPageShell
          showBackLink={false}
          titleId="vendors-title"
          eyebrow={pageMeta.eyebrow}
          title={pageMeta.title}
          titleIcon={Building2}
          description={pageMeta.description}
          maxWidthClass="max-w-[1600px]"
          contentClassName="mt-4"
          actions={
            <div className="flex flex-wrap items-end gap-2">
              <DocumentExportButtons
                onPrint={() => void handlePrintList()}
                onDownloadCsv={() => void handleDownloadListCsv()}
                onDownloadJson={() => void handleDownloadListJson()}
                printLabel={tr('printList')}
              />
              <button
                type="button"
                onClick={() => {
                  resetForm()
                  setCreateCodeNonce((n) => n + 1)
                  setShowModal(true)
                }}
                className={AQ_HERO_BTN_PRIMARY}
              >
                <Plus className="h-4 w-4" aria-hidden />
                <span>{tr('addEntity', { entity: ct('Vendor') })}</span>
              </button>
            </div>
          }
        >
        <p className="mb-4 text-sm text-muted-foreground">
          One record per supplier (payables). Where each delivery goes is chosen on{' '}
          <Link href="/bills" className="text-primary hover:underline">
            vendor bills
          </Link>
          , not by duplicating vendors per pond or site.
        </p>

        <div className="mb-6 rounded-lg border border-primary/25 bg-blue-50/90 px-4 py-3 text-sm text-blue-950">
          <div className="flex gap-3">
            <Info className="h-5 w-5 shrink-0 text-primary mt-0.5" aria-hidden />
            <div className="space-y-1.5 min-w-0">
              <p className="font-medium">How to set up suppliers</p>
              <ul className="list-disc pl-4 space-y-1 text-blue-900/95">
                <li>
                  <strong>Multi-site suppliers</strong> (feed to all ponds and all shops): leave{' '}
                  <em>Usual receiving location</em> blank; pick site or pond on each bill.
                </li>
                <li>
                  <strong>Usual receiving location</strong> is optional — it only pre-fills new bills when most
                  deliveries go to the same place.
                </li>
                <li>
                  Fuel vs aquaculture vs general POS is configured on{' '}
                  <Link href="/stations" className="text-primary underline hover:text-blue-900">
                    Stations
                  </Link>
                  ; do not create separate vendor records per business line.
                </li>
              </ul>
            </div>
          </div>
        </div>

        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="relative max-w-md flex-1">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 transform text-muted-foreground/70" />
            <input
              type="text"
              placeholder={ct('searchVendors')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-border py-2 pl-10 pr-4 focus:border-ring focus:ring-2 focus:ring-ring"
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-foreground/85">
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
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="erp-loading-spinner h-12 w-12"></div>
          </div>
        ) : error ? (
          <div className="bg-destructive/5 border border-destructive/25 rounded-lg p-6 text-center">
            <AlertTriangle className="h-12 w-12 text-destructive mx-auto mb-4" />
            <h3 className="text-xl font-bold text-destructive mb-2">{tr('errorLoading', { entity: ct('Vendors') })}</h3>
            <p className="text-destructive mb-4">{error}</p>
            <button
              onClick={fetchVendors}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-destructive text-white rounded-lg hover:bg-destructive/90 transition-colors"
            >
              <RefreshCw className="h-5 w-5" />
              <span>{tr('retry')}</span>
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm overflow-hidden border border-border">
            <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Vendor #
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Company
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Display Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider hidden md:table-cell">
                    <span className="inline-flex items-center gap-1">
                      <Building2 className="h-3.5 w-3.5 text-amber-600/90" />
                      Usual location
                    </span>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Balance
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-border">
                {vendors.map((vendor) => (
                  <tr key={vendor.id} className="hover:bg-muted/40">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-foreground">
                      {vendor.vendor_number}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                      {vendor.company_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {vendor.display_name}
                    </td>
                    <td className="px-6 py-4 text-sm text-foreground/85 max-w-[14rem] hidden md:table-cell">
                      <span className="inline-flex items-center gap-1.5">
                        {(vendor.default_aquaculture_pond_name || '').trim() ? (
                          <MapPin className="h-3.5 w-3.5 text-primary/85 shrink-0" />
                        ) : (
                          <Building2 className="h-3.5 w-3.5 text-amber-600/80 shrink-0" />
                        )}
                        <span className="truncate" title={defaultReceivingLabel(vendor)}>
                          {defaultReceivingLabel(vendor)}
                        </span>
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-muted-foreground">
                      {vendor.email}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">
                      {currencySymbol}{formatNumber(Number(vendor.current_balance || 0))}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        vendor.is_active ? 'bg-success/15 text-success' : 'bg-destructive/10 text-destructive'
                      }`}>
                        {vendor.is_active ? t('active') : t('inactive')}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end gap-1 sm:gap-2 shrink-0">
                        <Link
                          href={`/vendors/${vendor.id}/ledger`}
                          className="inline-flex touch-min items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-50 hover:text-emerald-800 transition-colors"
                          title="Vendor ledger"
                        >
                          <BookOpen className="h-4 w-4 shrink-0" />
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleEdit(vendor)}
                          className="inline-flex touch-min items-center justify-center rounded-md text-primary hover:bg-accent hover:text-primary/80 transition-colors"
                          title="Edit vendor"
                        >
                          <Edit className="h-4 w-4 shrink-0" />
                        </button>
                        {vendor.is_active ? (
                          <button
                            type="button"
                            onClick={() => setShowDeleteConfirm(vendor.id)}
                            className="inline-flex touch-min items-center justify-center rounded-md text-destructive hover:bg-destructive/5 hover:text-destructive transition-colors"
                            title="Delete vendor"
                          >
                            <Trash2 className="h-4 w-4 shrink-0" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleRestore(vendor.id)}
                            className="inline-flex touch-min items-center justify-center rounded-md text-emerald-600 hover:bg-emerald-50 hover:text-emerald-800 transition-colors"
                            title="Restore vendor"
                          >
                            <Undo2 className="h-4 w-4 shrink-0" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            {totalCount > 0 && (
              <div className="border-t border-border bg-muted/40 px-4 py-3">
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
              </div>
            )}
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="erp-modal-backdrop">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <h2 className="text-xl font-bold mb-4">{tr('deleteEntity', { entity: ct('Vendor') })}</h2>
              <p className="text-muted-foreground mb-6">
                {tr('deleteConfirmBody', { entity: ct('vendor') })} Enable &quot;Include inactive&quot; to find and restore this vendor later.
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowDeleteConfirm(null)}
                  className="erp-btn-secondary"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDelete(showDeleteConfirm)}
                  className="erp-btn-danger"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Create/Edit Modal */}
        {showModal && (
          <div className="erp-modal-backdrop">
            <div className="bg-white rounded-lg app-modal-pad max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <h2 className="mb-6 text-2xl font-bold text-foreground">
                {editingVendor ? tr('editEntity', { entity: ct('Vendor') }) : tr('addNewEntity', { entity: ct('Vendor') })}
              </h2>
              <form onSubmit={editingVendor ? handleUpdate : handleCreate}>
                {editingVendor ? (
                  <ReferenceCodePicker
                    kind="vendor"
                    id="vendor_ref_ro"
                    label="Vendor number"
                    value={editingVendor.vendor_number || ''}
                    onChange={() => {}}
                    disabled
                    className="mb-4"
                  />
                ) : (
                  <ReferenceCodePicker
                    key={createCodeNonce}
                    kind="vendor"
                    id="vendor_ref"
                    label="Vendor number"
                    value={vendorRefCode}
                    onChange={setVendorRefCode}
                    className="mb-4"
                  />
                )}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      Company Name
                    </label>
                    <input
                      type="text"
                      value={formData.company_name}
                      onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                      className="erp-field"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      Contact Person
                    </label>
                    <input
                      type="text"
                      value={formData.contact_person}
                      onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
                      className="erp-field"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Email</label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="erp-field"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">Phone</label>
                    <input
                      type="text"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="erp-field"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground/85 mb-2 inline-flex items-center gap-1.5">
                      <Building2 className="h-4 w-4 text-amber-600" />
                      Usual receiving location (optional)
                    </label>
                    <VendorDefaultReceivingSelect
                      value={formData.default_receiving}
                      onChange={(default_receiving) => {
                        const suggested = suggestVendorDefaultExpenseAccountId(
                          default_receiving,
                          coaExpenseOptions
                        )
                        setFormData({
                          ...formData,
                          default_receiving,
                          default_expense_account_id: mergeSuggestedStringField(
                            formData.default_expense_account_id,
                            suggested,
                            vendorExpenseAccountTouchedRef.current
                          ),
                        })
                      }}
                      stations={stations}
                      ponds={ponds}
                      className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring bg-white"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Does not restrict this supplier to one place. Pre-fills{' '}
                      <Link href="/bills" className="text-primary hover:underline">
                        vendor bills
                      </Link>{' '}
                      only. For pond defaults, a shop linked to that pond on{' '}
                      <Link href="/stations" className="text-primary hover:underline">
                        Stations
                      </Link>{' '}
                      is used when you pick a pond here.
                    </p>
                  </div>
                  <div className="col-span-2">
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      Default expense account (optional)
                    </label>
                    <CoaAccountCombobox
                      value={formData.default_expense_account_id}
                      onChange={(accountId) => {
                        syncBooleanFieldTouchedForAccountPick(
                          vendorExpenseAccountTouchedRef,
                          accountId
                        )
                        setFormData({ ...formData, default_expense_account_id: accountId })
                      }}
                      accounts={coaExpenseOptions}
                      emptyLabel={
                        formData.default_receiving
                          ? templateVendorDefaultExpenseOptionLabel(
                              formData.default_receiving,
                              coaExpenseOptions
                            )
                          : '— No vendor override (bill uses line item or system default) —'
                      }
                      className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring bg-white"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      <strong>Expense category for vendor bills</strong> (P&amp;L), not the account you pay from.
                      Suggested when you pick a usual location: site → 6920 station operating, pond → 6725 aquaculture
                      misc. You can change or clear this anytime. To pay from{' '}
                      <strong>bank or cash</strong>, use{' '}
                      <Link href="/payments/made/new" className="text-primary hover:underline">
                        Record vendor payment
                      </Link>{' '}
                      and select your bank register there.
                    </p>
                  </div>
                  <div className="col-span-2">
                    <label className="mb-2 block text-sm font-medium text-foreground">Address</label>
                    <input
                      type="text"
                      value={formData.billing_address_line1}
                      onChange={(e) => setFormData({ ...formData, billing_address_line1: e.target.value })}
                      className="erp-field"
                    />
                  </div>
                  <div className="col-span-2">
                    <p className="text-sm font-semibold text-foreground mb-2">Bank details (optional)</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="mb-2 block text-sm font-medium text-foreground">
                          Account number
                        </label>
                        <input
                          type="text"
                          value={formData.bank_account_number}
                          onChange={(e) =>
                            setFormData({ ...formData, bank_account_number: e.target.value })
                          }
                          className="erp-field"
                          autoComplete="off"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-foreground">
                          Bank name
                        </label>
                        <input
                          type="text"
                          value={formData.bank_name}
                          onChange={(e) =>
                            setFormData({ ...formData, bank_name: e.target.value })
                          }
                          className="erp-field"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-foreground">
                          Branch
                        </label>
                        <input
                          type="text"
                          value={formData.bank_branch}
                          onChange={(e) =>
                            setFormData({ ...formData, bank_branch: e.target.value })
                          }
                          className="erp-field"
                        />
                      </div>
                      <div>
                        <label className="mb-2 block text-sm font-medium text-foreground">
                          Routing number
                        </label>
                        <input
                          type="text"
                          value={formData.bank_routing_number}
                          onChange={(e) =>
                            setFormData({ ...formData, bank_routing_number: e.target.value })
                          }
                          className="erp-field"
                          placeholder="ABA / sort code / SWIFT as needed"
                        />
                      </div>
                    </div>
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
                      {editingVendor ? 'Update opening balance if needed' : 'Starting balance you owe this vendor'}
                    </p>
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      As of Date
                    </label>
                    <input
                      type="date"
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
                    {editingVendor ? 'Update Vendor' : 'Create Vendor'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        </ErpPageShell>
      </PageLayout>
    </CompanyProvider>
  )
}
