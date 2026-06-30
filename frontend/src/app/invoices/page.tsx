'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { AQ_HERO_BTN_PRIMARY } from '@/components/aquaculture/AquacultureUi'
import { Plus, Eye, Search, X, PlusCircle, Trash2, Send, CheckCircle, Edit2, FileText } from 'lucide-react'
import { DocumentExportButtons } from '@/components/DocumentExportButtons'
import { useToast } from '@/components/Toast'
import { usePageMeta } from '@/hooks/usePageMeta'
import { useT } from '@/lib/i18n'
import { useErpCommonT } from '@/lib/moduleI18n/erpCommon'
import api, { getApiBaseUrl, getBackendOrigin } from '@/lib/api'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { formatDate, formatDateOnly } from '@/utils/date'
import { escapeHtml } from '@/utils/printDocument'
import type { PrintBranding } from '@/utils/printBranding'
import { loadPrintBranding } from '@/utils/printBranding'
import { printListView } from '@/utils/printListView'
import {
  buildInvoiceDetailCsv,
  buildInvoiceListCsv,
  buildInvoicePrintHtml,
  downloadCsvFile,
  downloadJsonFile,
  invoiceDisplayNumber,
  printHtmlDocument,
} from '@/utils/businessDocumentExport'
import { AMOUNT_READ_ONLY_INPUT_CLASS } from '@/utils/amountFieldStyles'
import { formatCoaOptionLabel } from '@/utils/coaOptionLabel'
import { extractErrorMessage } from '@/utils/errorHandler'
import {
  COA_FUEL_REV,
  COA_SHOP_REV,
  suggestedInvoiceRevenueAccountId,
  templateCoaOptionLabel,
} from '@/lib/coaDefaults'
import { suggestItemGlAccountIds, itemGlCtxFromItemFields } from '@/lib/itemGlDefaults'
import {
  mergeSuggestedLineAccountId,
  parseSuggestedCoaId,
  syncLineTouchedForAccount,
} from '@/lib/coaSuggestForm'
import { InvoiceLineFormList, type InvoiceFormLine } from '@/components/invoices/InvoiceLineFormList'
import { CustomerReferenceCombobox } from '@/components/reference/CustomerReferenceCombobox'
import type { InvoiceLineKind } from '@/components/invoices/InvoiceLineTypePicker'
import type { AquacultureInvoiceIncomeCategory } from '@/lib/aquacultureInvoiceLine'
import { invoiceAquacultureIncomeFromApi } from '@/lib/aquacultureInvoiceLine'
import type { BillReceiptLocationPond, BillReceiptLocationStation } from '@/lib/billReceiptLocation'
import type { FuelStationInvoiceIncomeCategory } from '@/lib/fuelStationInvoiceLine'
import { invoiceFuelCategoriesFromApi } from '@/lib/fuelStationInvoiceLine'
import { clearEntityScopedReportingCategoryCache } from '@/lib/entityScopedReportingCategories'
import { isOffsetPagedPayload, offsetListParams, REFERENCE_FETCH_LIMIT, unwrapReferenceList } from '@/lib/pagination'
import {
  hasActiveTransactionFilters,
  hasTransactionTextSearch,
  transactionAmountParams,
  transactionDateParams,
} from '@/lib/transactionListFilters'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { TransactionListEmptyState } from '@/components/TransactionListEmptyState'
import { OffsetPaginationControls } from '@/components/ui/OffsetPaginationControls'
import { fetchEntityScopeDirectory } from '@/lib/entityScopeDirectory'

interface InvoiceLineItem extends InvoiceFormLine {}

interface Invoice {
  id: number
  invoice_number: string
  customer_id: number
  customer_name?: string
  invoice_date: string
  due_date: string
  subtotal: number
  tax_amount: number
  discount_amount?: number
  total_amount: number
  amount_paid?: number
  balance_due: number
  status: string
  source?: string
  pos_receipt_number?: string
  line_items?: InvoiceLineItem[]
}

interface Customer {
  id: number
  display_name: string
  company_name?: string
  customer_number: string
  is_active: boolean
}

interface Item {
  id: number
  item_number: string
  name: string
  unit_price: number | null
  unit: string
  is_deleted?: boolean
  revenue_account_id?: number | null
  pos_category?: string
  item_type?: string
  category?: string
}

interface CoaIncomeRow {
  id: number
  account_code: string
  account_name: string
  account_type: string
}

/** Map API `lines` (or `line_items`) to UI line_items with numeric fields. */
function normalizeInvoiceLinesFromApi(raw: Record<string, unknown>): InvoiceLineItem[] {
  const src = raw.line_items ?? raw.lines
  if (!Array.isArray(src)) return []
  return src.map((row: Record<string, unknown>, i: number) => ({
    id: row.id != null ? Number(row.id) : undefined,
    line_number: Number(row.line_number ?? i + 1),
    item_id: row.item_id != null && row.item_id !== '' ? Number(row.item_id) : undefined,
    item_name: typeof row.item_name === 'string' && row.item_name.trim() ? row.item_name : undefined,
    description: typeof row.description === 'string' ? row.description : '',
    quantity: Number(row.quantity ?? 0),
    unit_price: Number(row.unit_price ?? 0),
    amount: Number(row.amount ?? 0),
    tax_amount: Number(row.tax_amount ?? 0),
    revenue_account_id:
      row.revenue_account_id != null && row.revenue_account_id !== ''
        ? Number(row.revenue_account_id)
        : undefined,
    line_receipt_station_id:
      row.line_receipt_station_id != null && row.line_receipt_station_id !== ''
        ? Number(row.line_receipt_station_id)
        : row.receipt_station_id != null && row.receipt_station_id !== ''
          ? Number(row.receipt_station_id)
          : undefined,
    aquaculture_pond_id:
      row.aquaculture_pond_id != null && row.aquaculture_pond_id !== ''
        ? Number(row.aquaculture_pond_id)
        : undefined,
    fuel_station_income_category:
      typeof row.fuel_station_income_category === 'string' ? row.fuel_station_income_category : '',
    aquaculture_income_category:
      typeof row.aquaculture_income_category === 'string' ? row.aquaculture_income_category : '',
  }))
}

/** API uses total / tax_total strings and `lines` on each invoice; UI uses total_amount / tax_amount / line_items. */
function normalizeInvoiceFromApi(raw: Record<string, unknown>): Invoice {
  const r = raw as Record<string, unknown>
  const base = { ...(raw as unknown as Invoice) }
  return {
    ...base,
    subtotal: Number(r.subtotal ?? 0),
    tax_amount: Number(r.tax_amount ?? r.tax_total ?? 0),
    total_amount: Number(r.total_amount ?? r.total ?? 0),
    balance_due: Number(r.balance_due ?? 0),
    customer_id: Number(r.customer_id ?? 0),
    customer_name:
      typeof r.customer_name === 'string' && r.customer_name.trim()
        ? r.customer_name
        : undefined,
    line_items: normalizeInvoiceLinesFromApi(r),
  }
}

export default function InvoicesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const pageMeta = usePageMeta()
  const { t } = useT()
  const tr = useErpCommonT()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingItems, setLoadingItems] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [searchTerm, setSearchTerm] = useState('')
  const debouncedSearch = useDebouncedValue(searchTerm.trim())
  const [sourceFilter, setSourceFilter] = useState<string>('all') // 'all', 'pos', 'manual'
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [minAmount, setMinAmount] = useState('')
  const [maxAmount, setMaxAmount] = useState('')
  const [listPage, setListPage] = useState(1)
  const [pageSize, setPageSize] = useState(50)
  const [totalCount, setTotalCount] = useState(0)
  const [showModal, setShowModal] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null)
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null)
  const [currencySymbol, setCurrencySymbol] = useState<string>('৳') // Default to BDT
  const [printBranding, setPrintBranding] = useState<PrintBranding | null>(null)
  const [revenueCoaOptions, setRevenueCoaOptions] = useState<CoaIncomeRow[]>([])
  const [stations, setStations] = useState<BillReceiptLocationStation[]>([])
  const [ponds, setPonds] = useState<BillReceiptLocationPond[]>([])
  const [pondIncomeCategories, setPondIncomeCategories] = useState<AquacultureInvoiceIncomeCategory[]>([])
  const [stationIncomeCategories, setStationIncomeCategories] = useState<FuelStationInvoiceIncomeCategory[]>([])
  const [companyName, setCompanyName] = useState('')
  /** Line numbers where the user explicitly picked a revenue account (do not auto-overwrite). */
  const invoiceLineRevenueTouchedRef = useRef(new Set<number>())
  const [formData, setFormData] = useState({
    customer_id: 0,
    invoice_date: new Date().toISOString().split('T')[0],
    due_date: '',
    lines: [] as InvoiceLineItem[]
  })

  const loadRevenueCoa = useCallback(async () => {
    try {
      const token = localStorage.getItem('access_token')
      if (!token) return
      const r = await api.get('/chart-of-accounts/', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const rows = Array.isArray(r.data) ? r.data : []
      setRevenueCoaOptions(
        rows
          .filter((x: { is_active?: boolean }) => x.is_active !== false)
          .map((x: { id: number; account_code?: string; account_name?: string; account_type?: string }) => ({
            id: x.id,
            account_code: String(x.account_code || ''),
            account_name: String(x.account_name || ''),
            account_type: String(x.account_type || ''),
          }))
          .filter((x) => x.account_type.toLowerCase() === 'income')
      )
    } catch {
      setRevenueCoaOptions([])
    }
  }, [])

  const loadInvoiceReferenceData = useCallback(async () => {
    clearEntityScopedReportingCategoryCache()
    try {
      const [scope, aqIncRes, fsIncRes, companyRes] = await Promise.all([
        fetchEntityScopeDirectory(),
        api.get('/aquaculture/income-types/').catch(() => ({ data: [] })),
        api.get('/fuel-station/income-categories/').catch(() => ({ data: [] })),
        api.get('/companies/current/').catch(() => ({ data: null })),
      ])
      setStations(scope.stations)
      setPonds(scope.ponds)
      const aqIncResData = aqIncRes.data
      if (Array.isArray(aqIncResData)) {
        setPondIncomeCategories(invoiceAquacultureIncomeFromApi(aqIncResData))
      }
      const fsIncResData = fsIncRes.data
      if (Array.isArray(fsIncResData)) {
        setStationIncomeCategories(invoiceFuelCategoriesFromApi(fsIncResData))
      }
      const companyData = companyRes.data as { name?: string; company_name?: string } | null
      if (companyData) {
        const name = String(companyData.name || companyData.company_name || '').trim()
        if (name) setCompanyName(name)
      }
    } catch (error) {
      console.error('Error loading invoice reference data:', error)
    }
  }, [])

  useEffect(() => {
    setListPage(1)
  }, [debouncedSearch, sourceFilter, startDate, endDate, minAmount, maxAmount, pageSize])

  const hasTextSearch = hasTransactionTextSearch({ q: debouncedSearch })

  const hasActiveFilters = hasActiveTransactionFilters({
    search: searchTerm,
    startDate,
    endDate,
    minAmount,
    maxAmount,
    extras: sourceFilter !== 'all',
  })

  const clearFilters = () => {
    setSearchTerm('')
    setSourceFilter('all')
    setStartDate('')
    setEndDate('')
    setMinAmount('')
    setMaxAmount('')
  }

  const loadInvoices = useCallback(async () => {
    try {
      setError(null)
      setLoading(true)
      const params = offsetListParams({
        page: listPage,
        pageSize,
        q: debouncedSearch || undefined,
        extra: {
          source_filter: sourceFilter !== 'all' ? sourceFilter : undefined,
          ...transactionDateParams(startDate, endDate, hasTextSearch),
          ...transactionAmountParams(minAmount, maxAmount),
        },
      })
      const response = await api.get('/invoices/', { params, timeout: 15000 })
      const data = response.data
      if (isOffsetPagedPayload(data)) {
        setInvoices(
          (data.results as Record<string, unknown>[]).map((row) => normalizeInvoiceFromApi(row)),
        )
        setTotalCount(data.count)
        const totalPages = Math.max(1, Math.ceil(data.count / pageSize))
        if (listPage > totalPages) setListPage(totalPages)
        setRetryCount(0)
      } else if (Array.isArray(data)) {
        setInvoices(data.map((row: Record<string, unknown>) => normalizeInvoiceFromApi(row)))
        setTotalCount(data.length)
      } else {
        setError('Invalid response format from invoices API')
        setInvoices([])
        setTotalCount(0)
      }
    } catch (error: unknown) {
      console.error('Error loading invoices:', error)
      setError(extractErrorMessage(error, 'Failed to load invoices'))
      setInvoices([])
      setTotalCount(0)
    } finally {
      setLoading(false)
    }
  }, [
    listPage,
    pageSize,
    debouncedSearch,
    sourceFilter,
    startDate,
    endDate,
    minAmount,
    maxAmount,
    hasTextSearch,
  ])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    void loadInvoices()
  }, [router, loadInvoices])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }

    fetchReferenceData()
  }, [router])

  // Fetch customers and items when modal opens
  useEffect(() => {
    if (showModal || showEditModal) {
      fetchCustomersAndItems()
      void loadRevenueCoa()
      void loadInvoiceReferenceData()
    }
  }, [showModal, showEditModal, loadRevenueCoa, loadInvoiceReferenceData])

  const invoiceRevenueRecommendLabel = useMemo(
    () =>
      templateCoaOptionLabel(COA_FUEL_REV, revenueCoaOptions) +
      ' (or item / ' +
      COA_SHOP_REV +
      ' shop)',
    [revenueCoaOptions]
  )

  const defaultInvoiceRevenueAccountId = useCallback((): number | undefined => {
    return parseSuggestedCoaId(suggestedInvoiceRevenueAccountId(revenueCoaOptions))
  }, [revenueCoaOptions])

  /** Active suggest: pre-fill revenue on empty invoice lines (create + edit modals). */
  useEffect(() => {
    if ((!showModal && !showEditModal) || revenueCoaOptions.length === 0) return
    const def = defaultInvoiceRevenueAccountId()
    if (!def) return
    setFormData((prev) => {
      let changed = false
      const lines = prev.lines.map((line) => {
        if (invoiceLineRevenueTouchedRef.current.has(line.line_number)) return line
        if (line.revenue_account_id != null && line.revenue_account_id > 0) return line
        changed = true
        return { ...line, revenue_account_id: def }
      })
      return changed ? { ...prev, lines } : prev
    })
  }, [
    showModal,
    showEditModal,
    revenueCoaOptions,
    defaultInvoiceRevenueAccountId,
    formData.lines.length,
  ])

  const fetchReferenceData = useCallback(async () => {
    try {
      const companyRes = await api.get('/companies/current')
      if (companyRes.data?.currency) {
        setCurrencySymbol(getCurrencySymbol(companyRes.data.currency))
      }
    } catch (error) {
      console.error('Error fetching company currency:', error)
    }
    void loadPrintBranding(api).then(setPrintBranding).catch(() => setPrintBranding(null))
    void api
      .get('/customers/', { params: { skip: 0, limit: REFERENCE_FETCH_LIMIT } })
      .then((res) => {
        const raw = unwrapReferenceList<Customer>(res.data)
        setCustomers(raw.filter((c) => c.is_active !== false))
      })
      .catch(() => {})
    void loadInvoiceReferenceData()
  }, [loadInvoiceReferenceData])

  const handleRetry = () => {
    setRetryCount((prev) => prev + 1)
    void loadInvoices()
  }

  const fetchCustomersAndItems = async () => {
    setLoadingItems(true)
    try {
      const [customersRes, itemsRes] = await Promise.allSettled([
        api.get('/customers/', { params: { skip: 0, limit: REFERENCE_FETCH_LIMIT } }),
        api.get('/items/', { params: { skip: 0, limit: REFERENCE_FETCH_LIMIT } }),
      ])

      if (customersRes.status === 'fulfilled') {
        const raw = unwrapReferenceList<Customer>(customersRes.value.data)
        setCustomers(raw.filter((c) => c.is_active !== false))
      } else {
        console.error('Failed to load customers:', customersRes.reason)
        toast.error(extractErrorMessage(customersRes.reason, 'Failed to load customers'))
      }

      if (itemsRes.status === 'fulfilled') {
        const raw = unwrapReferenceList<Item>(itemsRes.value.data)
        const validItems = raw.filter(
          (item) => item && item.id && item.name && !item.is_deleted,
        )
        setItems(validItems)
        if (validItems.length === 0) {
          console.warn('No valid items found. Raw data:', itemsRes.value.data)
        }
      } else {
        console.error('Failed to load items:', itemsRes.reason)
        toast.error(extractErrorMessage(itemsRes.reason, 'Failed to load items'))
      }
    } catch (error) {
      console.error('Error fetching customers/items:', error)
      toast.error('Failed to load customers or items')
    } finally {
      setLoadingItems(false)
    }
  }

  // Get display number: pos_receipt_number for POS invoices, invoice_number for manual invoices
  const getDisplayNumber = (invoice: Invoice) => {
    if (invoice.source && (invoice.source === 'pos_fuel' || invoice.source === 'pos_general' || invoice.source === 'pos_mixed')) {
      return invoice.pos_receipt_number || invoice.invoice_number || ''
    }
    return invoice.invoice_number || ''
  }

  const resolveInvoiceCustomerLabel = (invoice: {
    customer_name?: string | null
    customer_id?: number
  }): string => {
    const fromApi = (invoice.customer_name || '').trim()
    if (fromApi) return fromApi
    const c = invoice.customer_id
      ? customers.find((x) => x.id === invoice.customer_id)
      : undefined
    if (c) {
      const label = (c.display_name || c.company_name || c.customer_number || '').trim()
      if (label) return label
    }
    return invoice.customer_id ? `Customer #${invoice.customer_id}` : '—'
  }

  const filteredInvoices = invoices

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'paid':
        return 'bg-success/15 text-success'
      case 'sent':
      case 'partially_paid':
        return 'bg-yellow-100 text-yellow-800'
      case 'overdue':
        return 'bg-destructive/10 text-destructive'
      case 'draft':
        return 'bg-muted text-foreground'
      default:
        return 'bg-muted text-foreground'
    }
  }

  const getSourceBadge = (source?: string) => {
    if (!source) return null
    const sourceMap: { [key: string]: { label: string; color: string } } = {
      'pos_fuel': { label: 'POS Fuel', color: 'bg-blue-100 text-primary' },
      'pos_general': { label: 'POS General', color: 'bg-purple-100 text-purple-800' },
      'pos_mixed': { label: 'POS Mixed', color: 'bg-accent text-primary' },
      'manual': { label: 'Manual', color: 'bg-muted text-foreground' },
      'aquaculture_pond_sale': { label: 'Aquaculture', color: 'bg-teal-100 text-primary' },
    }
    const sourceInfo = sourceMap[source] || { label: source, color: 'bg-muted text-foreground' }
    return (
      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${sourceInfo.color}`}>
        {sourceInfo.label}
      </span>
    )
  }

  const calculateLineAmount = (quantity: number, unitPrice: number) => {
    return quantity * unitPrice
  }

  const calculateTotals = () => {
    const subtotal = formData.lines.reduce((sum, line) => sum + (line.amount || 0), 0)
    const taxAmount = formData.lines.reduce((sum, line) => sum + (line.tax_amount || 0), 0)
    const total = subtotal + taxAmount
    return { subtotal, taxAmount, total }
  }

  const handleAddLine = () => {
    const lineNumber = formData.lines.length + 1
    const defRev = defaultInvoiceRevenueAccountId()
    setFormData({
      ...formData,
      lines: [
        ...formData.lines,
        {
          line_number: lineNumber,
          line_kind: 'item',
          description: '',
          quantity: 1,
          unit_price: 0,
          amount: 0,
          tax_amount: 0,
          ...(defRev ? { revenue_account_id: defRev } : {}),
        },
      ],
    })
  }

  const handleRemoveLine = (index: number) => {
    const newLines = formData.lines.filter((_, i) => i !== index)
      .map((line, i) => ({ ...line, line_number: i + 1 }))
    setFormData({ ...formData, lines: newLines })
  }

  const handleLineChange = (index: number, field: string, value: unknown) => {
    const newLines = [...formData.lines]
    newLines[index] = { ...newLines[index], [field]: value }
    if (field === 'revenue_account_id') {
      syncLineTouchedForAccount(
        invoiceLineRevenueTouchedRef.current,
        newLines[index].line_number,
        value as number | undefined
      )
    }

    if (field === 'quantity' || field === 'unit_price') {
      const quantity =
        field === 'quantity' ? parseFloat(String(value)) || 0 : newLines[index].quantity
      const unitPrice =
        field === 'unit_price' ? parseFloat(String(value)) || 0 : newLines[index].unit_price
      newLines[index].amount = calculateLineAmount(quantity, unitPrice)
    }

    setFormData({ ...formData, lines: newLines })
  }

  const handleLineBundle = (index: number, patch: Partial<InvoiceLineItem>) => {
    const newLines = [...formData.lines]
    newLines[index] = { ...newLines[index], ...patch }
    setFormData({ ...formData, lines: newLines })
  }

  const handleChangeLineKind = (index: number, kind: InvoiceLineKind) => {
    const newLines = [...formData.lines]
    newLines[index] = {
      ...newLines[index],
      line_kind: kind,
      item_id: undefined,
      description: '',
      unit_price: 0,
      amount: calculateLineAmount(newLines[index].quantity || 1, 0),
      aquaculture_income_category: '',
      fuel_station_income_category: '',
    }
    if (!invoiceLineRevenueTouchedRef.current.has(newLines[index].line_number)) {
      const defRev = defaultInvoiceRevenueAccountId()
      newLines[index].revenue_account_id = defRev
    }
    setFormData({ ...formData, lines: newLines })
  }

  const applyInvoiceLineFromPicker = useCallback(
    (index: number, itemId: number, kind: InvoiceLineKind) => {
      const item = items.find((i) => i.id === itemId)
      if (!item) {
        toast.error(`Item with ID ${itemId} not found`)
        return
      }
      const unitPrice =
        item.unit_price != null && item.unit_price !== undefined
          ? parseFloat(String(item.unit_price))
          : 0
      setFormData((prev) => {
        const newLines = [...prev.lines]
        const row = { ...newLines[index], line_kind: kind, item_id: itemId }
        row.unit_price = unitPrice
        row.description = item.name || ''
        if (!invoiceLineRevenueTouchedRef.current.has(row.line_number)) {
          const itemRev =
            item.revenue_account_id != null && Number(item.revenue_account_id) > 0
              ? Number(item.revenue_account_id)
              : undefined
          const itemSuggestedRev = itemRev
            ? undefined
            : parseSuggestedCoaId(
                suggestItemGlAccountIds(itemGlCtxFromItemFields(item), revenueCoaOptions)
                  .revenue_account_id
              )
          row.revenue_account_id = mergeSuggestedLineAccountId(
            itemRev ?? itemSuggestedRev,
            defaultInvoiceRevenueAccountId(),
            false
          )
        }
        row.amount = calculateLineAmount(row.quantity || 1, unitPrice)
        newLines[index] = row
        return { ...prev, lines: newLines }
      })
      if (unitPrice === 0) {
        toast.warning(`Item "${item.name}" has no unit price set. Please enter a price manually.`)
      }
    },
    [items, toast, defaultInvoiceRevenueAccountId, revenueCoaOptions]
  )

  const serializeInvoiceLinePayload = (line: InvoiceLineItem) => {
    const quantity = parseFloat(line.quantity.toString())
    const unitPrice = parseFloat(line.unit_price.toString())
    return {
      item_id: line.item_id && line.item_id > 0 ? line.item_id : null,
      description: line.description && line.description.trim() ? line.description.trim() : null,
      quantity,
      unit_price: unitPrice,
      revenue_account_id:
        line.revenue_account_id != null && line.revenue_account_id > 0
          ? line.revenue_account_id
          : null,
      line_receipt_station_id:
        line.line_receipt_station_id != null && line.line_receipt_station_id !== ''
          ? Number(line.line_receipt_station_id)
          : null,
      aquaculture_pond_id:
        line.aquaculture_pond_id != null && line.aquaculture_pond_id !== ''
          ? Number(line.aquaculture_pond_id)
          : null,
      fuel_station_income_category: (line.fuel_station_income_category || '').trim() || null,
      aquaculture_income_category: (line.aquaculture_income_category || '').trim() || null,
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.customer_id || formData.customer_id === 0) {
      toast.error(tr('selectCustomer'))
      return
    }

    if (formData.lines.length === 0) {
      toast.error(tr('addLineItem'))
      return
    }

    // Validate line items
    const validLines = formData.lines.filter(line => {
      // Allow lines with either item_id OR description
      const hasItem = line.item_id && line.item_id > 0
      const hasDescription = line.description && line.description.trim().length > 0
      const hasQuantity = line.quantity > 0
      const hasPrice = line.unit_price > 0
      
      return (hasItem || hasDescription) && hasQuantity && hasPrice
    })

    if (validLines.length === 0) {
      toast.error('Please ensure all line items have an item selected (or description), quantity > 0, and unit price > 0')
      return
    }

    if (validLines.length !== formData.lines.length) {
      toast.error('Some line items are invalid. Please check that all items have quantity > 0 and unit price > 0')
      return
    }

    try {
      const token = localStorage.getItem('access_token')
      if (!token) {
        toast.error('Authentication required')
        return
      }
      
      const baseUrl = getApiBaseUrl()
      const { subtotal, taxAmount, total } = calculateTotals()

      // Ensure we have valid data
      const payload = {
        customer_id: formData.customer_id,
        invoice_date: formData.invoice_date,
        due_date: formData.due_date || null,
        subtotal,
        tax_total: taxAmount,
        total,
        line_items: validLines.map((line) => {
          const quantity = parseFloat(line.quantity.toString())
          const unitPrice = parseFloat(line.unit_price.toString())
          if (quantity <= 0) {
            throw new Error(`Line item ${validLines.indexOf(line) + 1}: Quantity must be greater than 0`)
          }
          if (unitPrice < 0) {
            throw new Error(`Line item ${validLines.indexOf(line) + 1}: Unit price cannot be negative`)
          }
          return serializeInvoiceLinePayload(line)
        })
      }
      

      const response = await fetch(`${baseUrl}/invoices/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        toast.success(tr('invoiceCreated'))
        setShowModal(false)
        resetForm()
        void loadInvoices()
      } else {
        const errorData = await response.json().catch(() => ({}))
        console.error('Failed to create invoice:', response.status, errorData)
        
        // Extract error message
        let errorMessage = 'Failed to create invoice'
        if (errorData.detail) {
          if (typeof errorData.detail === 'string') {
            errorMessage = errorData.detail
            // Try to extract more meaningful error from SQLite errors
            if (errorMessage.includes('IntegrityError')) {
              if (errorMessage.includes('UNIQUE constraint')) {
                errorMessage = 'A record with this information already exists. Please check for duplicates.'
              } else if (errorMessage.includes('NOT NULL constraint')) {
                errorMessage = 'Required field is missing. Please check all required fields are filled.'
              } else if (errorMessage.includes('FOREIGN KEY constraint')) {
                errorMessage = 'Invalid reference. Please ensure all selected items and customers are valid.'
              } else {
                errorMessage = 'Database error: ' + errorMessage.split('(')[0] || errorMessage
              }
            }
          } else if (Array.isArray(errorData.detail)) {
            errorMessage = errorData.detail.map((err: any) => 
              `${err.loc?.join('.')}: ${err.msg}`
            ).join(', ')
          }
        }
        
        console.error('Invoice creation error details:', errorData)
        toast.error(errorMessage)
      }
    } catch (error) {
      console.error('Error creating invoice:', error)
      toast.error('Error connecting to server')
    }
  }

  const resetForm = () => {
    invoiceLineRevenueTouchedRef.current.clear()
    setFormData({
      customer_id: 0,
      invoice_date: new Date().toISOString().split('T')[0],
      due_date: '',
      lines: []
    })
  }

  const handleCloseModal = () => {
    setShowModal(false)
    resetForm()
  }

  const handleOpenModal = () => {
    setShowModal(true)
    // Ensure items are loaded when modal opens
    if (items.length === 0) {
      fetchCustomersAndItems()
    }
  }

  const handlePostInvoice = async (invoiceId: number, invoiceNumber: string) => {
    if (!confirm(`Are you sure you want to post invoice ${invoiceNumber}? This will change its status to SENT and post it to accounts.`)) {
      return
    }

    try {
      const response = await api.put(`/invoices/${invoiceId}/status`, {
        new_status: 'sent'
      })

      if (response.status === 200) {
        toast.success(`Invoice ${invoiceNumber} posted successfully!`)
        void loadInvoices() // Refresh the invoice list
      } else {
        console.error('Failed to post invoice:', response.status)
        toast.error('Failed to post invoice')
      }
    } catch (error: any) {
      console.error('Error posting invoice:', error)
      const errorMessage = error.response?.data?.detail || 'Error posting invoice'
      toast.error(errorMessage)
    }
  }

  const handleViewInvoice = async (invoiceId: number) => {
    try {
      const response = await api.get(`/invoices/${invoiceId}`)
      if (response.status === 200) {
        setViewingInvoice(normalizeInvoiceFromApi(response.data as Record<string, unknown>))
        setShowViewModal(true)
        if (items.length === 0) {
          fetchCustomersAndItems()
        }
      } else {
        toast.error('Failed to load invoice details')
      }
    } catch (error: any) {
      console.error('Error viewing invoice:', error)
      toast.error(error.response?.data?.detail || 'Error loading invoice')
    }
  }

  const invoiceViewDeepLinkConsumed = useRef(false)
  useEffect(() => {
    if (invoiceViewDeepLinkConsumed.current || loading) return
    const raw = searchParams.get('view')
    if (!raw || !/^\d+$/.test(raw)) return
    const id = parseInt(raw, 10)
    if (!Number.isFinite(id) || id <= 0) return
    invoiceViewDeepLinkConsumed.current = true
    void handleViewInvoice(id)
    window.history.replaceState({}, '', '/invoices')
  }, [loading, searchParams])

  const handleEditInvoice = async (invoice: Invoice) => {
    try {
      // Fetch full invoice details with line items
      const response = await api.get(`/invoices/${invoice.id}`)
      if (response.status === 200) {
        const fullInvoice = normalizeInvoiceFromApi(response.data as Record<string, unknown>)
        setEditingInvoice(fullInvoice)
        invoiceLineRevenueTouchedRef.current.clear()
        const li = fullInvoice.line_items || []
        for (const item of li) {
          const ln = item.line_number ?? 0
          const rev = item.revenue_account_id != null ? Number(item.revenue_account_id) : 0
          if (ln > 0 && rev > 0) invoiceLineRevenueTouchedRef.current.add(ln)
        }
        setFormData({
          customer_id: fullInvoice.customer_id,
          invoice_date: fullInvoice.invoice_date,
          due_date: fullInvoice.due_date || '',
          lines: li.map((item: InvoiceLineItem, idx: number) => ({
            line_number: item.line_number ?? idx + 1,
            item_id: item.item_id || undefined,
            description: item.description || '',
            quantity: Number(item.quantity),
            unit_price: Number(item.unit_price || 0),
            amount: Number(item.amount || 0),
            tax_amount: Number(item.tax_amount || 0),
            revenue_account_id:
              item.revenue_account_id != null && Number(item.revenue_account_id) > 0
                ? Number(item.revenue_account_id)
                : undefined,
          })),
        })
        setShowEditModal(true)
      } else {
        toast.error('Failed to load invoice details')
      }
    } catch (error: any) {
      console.error('Error loading invoice for edit:', error)
      toast.error(error.response?.data?.detail || 'Error loading invoice')
    }
  }

  const handleUpdateInvoice = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!editingInvoice) return
    
    if (!formData.customer_id || formData.customer_id === 0) {
      toast.error(tr('selectCustomer'))
      return
    }

    if (formData.lines.length === 0) {
      toast.error(tr('addLineItem'))
      return
    }

    // Validate line items
    const validLines = formData.lines.filter(line => {
      const hasItem = line.item_id && line.item_id > 0
      const hasDescription = line.description && line.description.trim().length > 0
      const hasQuantity = line.quantity > 0
      const hasPrice = line.unit_price > 0
      
      return (hasItem || hasDescription) && hasQuantity && hasPrice
    })

    if (validLines.length === 0) {
      toast.error('Please ensure all line items have an item selected (or description), quantity > 0, and unit price > 0')
      return
    }

    try {
      const { subtotal, taxAmount, total } = calculateTotals()
      const response = await api.put(`/invoices/${editingInvoice.id}`, {
        customer_id: formData.customer_id,
        invoice_date: formData.invoice_date,
        due_date: formData.due_date || null,
        subtotal,
        tax_total: taxAmount,
        total,
        line_items: validLines.map((line) => serializeInvoiceLinePayload(line))
      })

      if (response.status === 200) {
        toast.success('Invoice updated successfully!')
        setShowEditModal(false)
        setEditingInvoice(null)
        resetForm()
        void loadInvoices()
      } else {
        console.error('Failed to update invoice:', response.status)
        toast.error('Failed to update invoice')
      }
    } catch (error: any) {
      console.error('Error updating invoice:', error)
      const errorMessage = error.response?.data?.detail || 'Error updating invoice'
      toast.error(errorMessage)
    }
  }

  const handleDeleteInvoice = async (invoiceId: number, invoiceNumber: string) => {
    if (!confirm(`Are you sure you want to delete invoice ${invoiceNumber}? This will reverse all effects (inventory, journal entries, payments) and cannot be undone.`)) {
      return
    }

    try {
      const response = await api.delete(`/invoices/${invoiceId}`)

      if (response.status === 204 || response.status === 200) {
        toast.success(`Invoice ${invoiceNumber} deleted successfully!`)
        void loadInvoices() // Refresh the invoice list
      } else {
        console.error('Failed to delete invoice:', response.status)
        toast.error('Failed to delete invoice')
      }
    } catch (error: any) {
      console.error('Error deleting invoice:', error)
      const errorMessage = error.response?.data?.detail || 'Error deleting invoice'
      toast.error(errorMessage)
    }
  }

  const handleCloseEditModal = () => {
    setShowEditModal(false)
    setEditingInvoice(null)
    resetForm()
  }

  const handleCloseViewModal = () => {
    setShowViewModal(false)
    setViewingInvoice(null)
  }

  const handlePrintInvoiceList = async () => {
    if (filteredInvoices.length === 0) {
      toast.error('No invoices to print for the current filter.')
      return
    }
    const sub = [
      `Source filter: ${sourceFilter}`,
      searchTerm && `Search: ${searchTerm}`,
      `Generated ${formatDate(new Date(), true)}`,
    ]
      .filter(Boolean)
      .join(' · ')
    const rows = filteredInvoices
      .map(
        (inv) => `<tr>
        <td>${escapeHtml(getDisplayNumber(inv))}</td>
        <td>${escapeHtml(String(inv.source || '—'))}</td>
        <td>${escapeHtml(formatDateOnly(inv.invoice_date))}</td>
        <td>${escapeHtml(inv.due_date ? formatDateOnly(inv.due_date) : '—')}</td>
        <td>${escapeHtml(resolveInvoiceCustomerLabel(inv))}</td>
        <td class="right">${escapeHtml(currencySymbol)}${escapeHtml(formatNumber(Number(inv.total_amount || 0)))}</td>
        <td>${escapeHtml(inv.status)}</td>
      </tr>`
      )
      .join('')
    const tableHtml = `<table><thead><tr><th>Invoice #</th><th>Source</th><th>Date</th><th>Due</th><th>Customer</th><th class="right">Total</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`
    const ok = await printListView({
      title: 'Invoices (list)',
      subtitle: sub,
      tableHtml,
    })
    if (!ok) toast.error('Allow pop-ups to print, or check your browser settings.')
  }

  const handlePrintViewingInvoice = async () => {
    if (!viewingInvoice) return
    const branding = printBranding ?? (await loadPrintBranding(api))
    const bodyHtml = buildInvoicePrintHtml(viewingInvoice, {
      currencySymbol,
      formatDateOnly,
      formatDateTime: (d) => formatDate(d, true),
      resolveCustomer: resolveInvoiceCustomerLabel,
      resolveItemLabel: (item) =>
        items.find((i) => i.id === item.item_id)?.name ||
        item.item_name ||
        (item.item_id ? `Item #${item.item_id}` : '—'),
      formatNumber,
    })
    const ok = await printHtmlDocument(
      `Invoice ${invoiceDisplayNumber(viewingInvoice)}`,
      bodyHtml,
      branding,
    )
    if (!ok) toast.error('Allow pop-ups to print, or check your browser settings.')
  }

  const handleDownloadInvoiceListCsv = () => {
    if (filteredInvoices.length === 0) {
      toast.error('No invoices to export.')
      return
    }
    downloadCsvFile(
      `invoices_${new Date().toISOString().slice(0, 10)}.csv`,
      buildInvoiceListCsv(filteredInvoices, {
        formatDate: formatDateOnly,
        resolveCustomer: resolveInvoiceCustomerLabel,
      }),
    )
  }

  const handleDownloadInvoiceListJson = () => {
    if (filteredInvoices.length === 0) {
      toast.error('No invoices to export.')
      return
    }
    downloadJsonFile(`invoices_${new Date().toISOString().slice(0, 10)}.json`, filteredInvoices)
  }

  const handleDownloadViewingInvoiceCsv = () => {
    if (!viewingInvoice) return
    downloadCsvFile(`invoice_${invoiceDisplayNumber(viewingInvoice)}.csv`, buildInvoiceDetailCsv(viewingInvoice, currencySymbol))
  }

  const handleDownloadViewingInvoiceJson = () => {
    if (!viewingInvoice) return
    downloadJsonFile(`invoice_${invoiceDisplayNumber(viewingInvoice)}.json`, viewingInvoice)
  }

  return (
    <PageLayout>
      <ErpPageShell
        showBackLink={false}
        title={pageMeta.title}
        titleIcon={FileText}
        description={pageMeta.description}
        maxWidthClass="max-w-[1600px]"
        contentClassName="mt-4"
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <DocumentExportButtons
              onPrint={() => void handlePrintInvoiceList()}
              onDownloadCsv={handleDownloadInvoiceListCsv}
              onDownloadJson={handleDownloadInvoiceListJson}
              disabled={filteredInvoices.length === 0}
              printLabel={tr('printList')}
            />
            <button
              type="button"
              onClick={handleOpenModal}
              className={AQ_HERO_BTN_PRIMARY}
            >
              <Plus className="h-4 w-4" aria-hidden />
              <span>{tr('newEntity', { entity: tr('Invoice') })}</span>
            </button>
          </div>
        }
      >
        {printBranding && (
          <p className="mb-4 text-sm text-foreground rounded-lg border border-border bg-muted/40/80 px-3 py-2 max-w-2xl">
            <span className="font-semibold">{printBranding.companyName}</span>
            {printBranding.stationName ? (
              <span className="text-muted-foreground"> · Station: {printBranding.stationName}</span>
            ) : null}
            {printBranding.companyAddress ? (
              <span className="block text-muted-foreground text-xs mt-1 font-normal">
                {printBranding.companyAddress}
              </span>
            ) : null}
          </p>
        )}

        <div className="mb-6 flex min-w-0 w-full flex-col gap-3">
          <div className="flex min-w-0 w-full flex-col gap-3 sm:min-w-[16rem] sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="relative max-w-md flex-1">
                <Search className="erp-search-icon" />
                <input
                  type="text"
                  placeholder={tr('searchInvoiceNumber')}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-blue-500 transition-all shadow-sm"
                />
              </div>
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                className="px-4 py-2.5 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-blue-500 transition-all shadow-sm bg-white"
              >
                <option value="all">{tr('allInvoices')}</option>
                <option value="pos">{tr('posInvoices')}</option>
                <option value="manual">{tr('manualInvoices')}</option>
              </select>
            </div>
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border bg-white px-3 py-1.5 text-sm font-medium text-foreground/85 shadow-sm hover:bg-muted/40"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
                Clear filters
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="px-3 py-2 border border-border rounded-lg" aria-label="From date" />
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="px-3 py-2 border border-border rounded-lg" aria-label="To date" />
            <input type="number" min="0" step="0.01" placeholder="Min amount" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} className="px-3 py-2 border border-border rounded-lg" />
            <input type="number" min="0" step="0.01" placeholder="Max amount" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} className="px-3 py-2 border border-border rounded-lg" />
          </div>
          {hasTextSearch && (startDate || endDate) ? (
            <p className="text-xs text-muted-foreground">Search spans all dates — date range paused while searching.</p>
          ) : null}
        </div>

        {loading ? (
          <div className="flex flex-col justify-center items-center h-64 bg-white rounded-lg shadow">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
            <p className="text-muted-foreground">{tr('loadingEntity', { entity: tr('invoice') })}</p>
          </div>
        ) : error ? (
          <div className="bg-white rounded-lg shadow app-modal-pad">
            <div className="flex flex-col items-center justify-center text-center">
              <div className="bg-destructive/10 rounded-full p-4 mb-4">
                <FileText className="h-12 w-12 text-destructive" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Unable to Load Invoices</h3>
              <p className="text-muted-foreground mb-6 max-w-md">{error}</p>
              <div className="flex gap-3">
                <button
                  onClick={handleRetry}
                  className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary transition-colors flex items-center gap-2"
                >
                  <span>Retry</span>
                  {retryCount > 0 && <span className="text-sm opacity-75">({retryCount})</span>}
                </button>
                <button
                  onClick={() => void loadInvoices()}
                  className="px-4 py-2 border border-border text-foreground/85 rounded-lg hover:bg-muted/40 transition-colors"
                >
                  Refresh
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border">
                <thead className="bg-gradient-to-r from-muted/40 to-muted">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-foreground/85 uppercase tracking-wider">
                      Invoice #
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-foreground/85 uppercase tracking-wider">
                      Source
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-foreground/85 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-foreground/85 uppercase tracking-wider">
                      Due Date
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-foreground/85 uppercase tracking-wider">
                      Customer
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-foreground/85 uppercase tracking-wider">
                      Subtotal
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-foreground/85 uppercase tracking-wider">
                      Tax
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-foreground/85 uppercase tracking-wider">
                      Total
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-foreground/85 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-foreground/85 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-border">
                  {filteredInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="p-0">
                        <TransactionListEmptyState
                          icon={<FileText className="h-10 w-10 text-muted-foreground/70" />}
                          title="No invoices in this view"
                          description={
                            hasActiveFilters
                              ? 'Try adjusting search, dates, amounts, or source filter.'
                              : "You haven't created any invoices yet. Create your first invoice to get started."
                          }
                          hasActiveFilters={hasActiveFilters}
                          onClearFilters={clearFilters}
                          action={
                            !hasActiveFilters ? (
                              <button
                                onClick={handleOpenModal}
                                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-white transition-colors hover:bg-primary"
                              >
                                <Plus className="h-5 w-5" />
                                <span>Create first invoice</span>
                              </button>
                            ) : undefined
                          }
                        />
                      </td>
                    </tr>
                  ) : (
                    filteredInvoices.map((invoice) => (
                    <tr key={invoice.id} className="hover:bg-accent transition-colors border-b border-border/70">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-semibold text-foreground">
                          {getDisplayNumber(invoice)}
                        </div>
                        {invoice.source && (invoice.source === 'pos_fuel' || invoice.source === 'pos_general' || invoice.source === 'pos_mixed') && invoice.invoice_number && invoice.invoice_number !== invoice.pos_receipt_number && (
                          <div className="text-xs text-muted-foreground mt-1">
                            Invoice: {invoice.invoice_number}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getSourceBadge(invoice.source)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground/85">
                        {formatDateOnly(invoice.invoice_date)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground/85">
                        {invoice.due_date ? formatDateOnly(invoice.due_date) : <span className="text-muted-foreground/70">—</span>}
                      </td>
                      <td className="px-6 py-4 text-sm text-foreground max-w-[14rem]">
                        <span className="line-clamp-2" title={resolveInvoiceCustomerLabel(invoice)}>
                          {resolveInvoiceCustomerLabel(invoice)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-foreground">
                        {currencySymbol}{Number(invoice.subtotal || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-foreground">
                        {currencySymbol}{Number(invoice.tax_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-foreground">
                        {currencySymbol}{Number(invoice.total_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(invoice.status)}`}>
                          {invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1).replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center justify-end gap-2">
                          {invoice.status === 'draft' && invoice.source === 'manual' && (
                            <button
                              onClick={() => handlePostInvoice(invoice.id, invoice.invoice_number)}
                              className="p-2 text-success hover:text-success hover:bg-green-50 rounded-lg transition-colors"
                              title="Post Invoice (Change status to SENT)"
                            >
                              <Send className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleViewInvoice(invoice.id)}
                            className="p-2 text-primary hover:text-primary hover:bg-accent rounded-lg transition-colors"
                            title="View Invoice"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {invoice.status !== 'void' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleEditInvoice(invoice)}
                                disabled={invoice.status === 'paid' || invoice.status === 'partially_paid'}
                                className={`p-2 rounded-lg transition-colors ${
                                  invoice.status === 'paid' || invoice.status === 'partially_paid'
                                    ? 'text-muted-foreground/70 cursor-not-allowed'
                                    : 'text-primary hover:text-primary hover:bg-accent'
                                }`}
                                title={invoice.status === 'paid' || invoice.status === 'partially_paid' ? 'Cannot edit paid invoice' : 'Edit invoice'}
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteInvoice(invoice.id, invoice.invoice_number)}
                                className="p-2 text-destructive hover:text-destructive hover:bg-destructive/5 rounded-lg transition-colors"
                                title="Delete invoice"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                  )}
                </tbody>
              </table>
            </div>
            {invoices.length > 0 && (
              <div className="bg-muted/40 px-6 py-3 border-t border-border space-y-3">
                <OffsetPaginationControls
                  page={listPage}
                  pageSize={pageSize}
                  total={totalCount}
                  onPageChange={setListPage}
                  onPageSizeChange={setPageSize}
                  disabled={loading}
                />
              </div>
            )}
          </div>
        )}

        {/* Create Invoice Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
            <div className="bg-white rounded-lg app-modal-pad max-w-5xl w-full max-h-[90vh] overflow-y-auto my-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Add New Invoice</h2>
                <button
                  onClick={handleCloseModal}
                  className="text-muted-foreground/70 hover:text-muted-foreground"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <form onSubmit={handleCreate}>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      Customer *
                    </label>
                    <CustomerReferenceCombobox
                      value={formData.customer_id}
                      onChange={(customerId) => setFormData({ ...formData, customer_id: customerId })}
                      customers={customers}
                      className="erp-field"
                    />
                    {customers.length === 0 && (
                      <p className="mt-1 text-xs text-destructive">
                        No active customers found. Please create a customer first.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      Invoice Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={formData.invoice_date}
                      onChange={(e) => setFormData({ ...formData, invoice_date: e.target.value })}
                      className="erp-field"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      Due Date
                    </label>
                    <input
                      type="date"
                      value={formData.due_date}
                      onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                      className="erp-field"
                    />
                  </div>
                </div>

                {/* Line Items */}
                <div className="mb-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold">Line Items</h3>
                    <div className="flex items-center gap-2">
                      {items.length === 0 && !loadingItems && (
                        <button
                          type="button"
                          onClick={fetchCustomersAndItems}
                          className="flex items-center space-x-1 px-3 py-1 text-sm bg-muted-foreground text-white rounded-lg hover:bg-muted-foreground"
                          title="Reload items"
                        >
                          <span>Reload Items</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleAddLine}
                        className="flex items-center space-x-1 px-3 py-1 text-sm bg-primary text-white rounded-lg hover:bg-primary"
                      >
                        <PlusCircle className="h-4 w-4" />
                        <span>Add Line</span>
                      </button>
                    </div>
                  </div>

                  <InvoiceLineFormList
                    lines={formData.lines}
                    items={items}
                    stations={stations}
                    ponds={ponds}
                    pondIncomeCategories={pondIncomeCategories}
                    stationIncomeCategories={stationIncomeCategories}
                    revenueCoaOptions={revenueCoaOptions}
                    revenueRecommendLabel={invoiceRevenueRecommendLabel}
                    currencySymbol={currencySymbol}
                    loadingItems={loadingItems}
                    companyName={companyName}
                    onApplyItem={applyInvoiceLineFromPicker}
                    onLineChange={handleLineChange}
                    onLineBundle={handleLineBundle}
                    onRemoveLine={handleRemoveLine}
                    onChangeLineKind={handleChangeLineKind}
                  />

                  {formData.lines.length === 0 && (
                    <p className="text-center text-muted-foreground py-4">No line items added. Click "Add Line" to add items.</p>
                  )}
                </div>

                {/* Totals */}
                {formData.lines.length > 0 && (
                  <div className="border-t pt-4 mb-6">
                    <div className="flex justify-end space-x-8">
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">Subtotal:</p>
                        <p className="text-sm text-muted-foreground">Tax:</p>
                        <p className="text-lg font-semibold text-foreground">Total:</p>
                      </div>
                      <div className="text-right min-w-[9rem] tabular-nums">
                        <p className="text-sm text-foreground">{currencySymbol}{formatNumber(calculateTotals().subtotal)}</p>
                        <p className="text-sm text-foreground">{currencySymbol}{formatNumber(calculateTotals().taxAmount)}</p>
                        <p className="text-lg font-semibold text-foreground">{currencySymbol}{formatNumber(calculateTotals().total)}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Form Actions */}
                <div className="flex justify-end space-x-4">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="px-4 py-2 border border-border rounded-lg text-foreground/85 hover:bg-muted/40"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="erp-btn-primary"
                  >
                    Create Invoice
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* View Invoice Modal */}
        {showViewModal && viewingInvoice && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto print:p-4 print:bg-white print:items-start">
            <div className="bg-white rounded-lg app-modal-pad max-w-4xl w-full max-h-[90vh] overflow-y-auto my-8 print:shadow-none print:max-h-none print:m-0 print:w-full">
              <div className="flex justify-between items-start gap-3 mb-6 print:hidden">
                <h2 className="text-2xl font-bold">Invoice Details</h2>
                <div className="flex items-center gap-2">
                  <DocumentExportButtons
                    size="compact"
                    onPrint={() => void handlePrintViewingInvoice()}
                    onDownloadCsv={handleDownloadViewingInvoiceCsv}
                    onDownloadJson={handleDownloadViewingInvoiceJson}
                  />
                  <button
                    onClick={handleCloseViewModal}
                    className="text-muted-foreground/70 hover:text-muted-foreground p-1"
                    aria-label="Close"
                  >
                    <X className="h-6 w-6" />
                  </button>
                </div>
              </div>

              {printBranding && (
                <div className="hidden print:block border-b border-border pb-3 mb-4 text-center">
                  <p className="text-base font-bold text-foreground">{printBranding.companyName}</p>
                  {printBranding.stationName ? (
                    <p className="text-xs font-semibold text-muted-foreground mt-1">Station: {printBranding.stationName}</p>
                  ) : null}
                  {printBranding.companyAddress ? (
                    <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">{printBranding.companyAddress}</p>
                  ) : null}
                </div>
              )}

              <div className="space-y-6 print:space-y-4">
                {/* On-screen: company + station (same as list header when data loaded) */}
                {printBranding && (
                  <div className="print:hidden rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
                    <p className="font-semibold">{printBranding.companyName}</p>
                    {printBranding.stationName ? (
                      <p className="text-muted-foreground mt-0.5">Station: {printBranding.stationName}</p>
                    ) : null}
                    {printBranding.companyAddress ? (
                      <p className="text-muted-foreground text-xs mt-1">{printBranding.companyAddress}</p>
                    ) : null}
                  </div>
                )}

                {/* Invoice Header */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Invoice Number</p>
                    <p className="text-lg font-semibold">{getDisplayNumber(viewingInvoice)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Status</p>
                    <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(viewingInvoice.status)}`}>
                      {viewingInvoice.status.charAt(0).toUpperCase() + viewingInvoice.status.slice(1).replace('_', ' ')}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Invoice Date</p>
                    <p className="text-lg">{formatDateOnly(viewingInvoice.invoice_date)}</p>
                  </div>
                  {viewingInvoice.due_date && (
                    <div>
                      <p className="text-sm text-muted-foreground">Due Date</p>
                      <p className="text-lg">{formatDateOnly(viewingInvoice.due_date)}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-muted-foreground">Customer</p>
                    <p className="text-lg font-medium text-foreground">{resolveInvoiceCustomerLabel(viewingInvoice)}</p>
                  </div>
                </div>

                {/* Line Items */}
                <div>
                  <h3 className="text-lg font-semibold mb-4">Line Items</h3>
                  <table className="min-w-full divide-y divide-border">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Item</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Description</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Quantity</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Unit Price</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-border">
                      {(viewingInvoice.line_items?.length ?? 0) === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-sm text-muted-foreground">
                            No line items on this invoice.
                          </td>
                        </tr>
                      ) : (
                        viewingInvoice.line_items!.map((item: InvoiceLineItem, idx: number) => (
                          <tr key={item.id ?? `line-${idx}`}>
                            <td className="px-4 py-3 text-sm text-foreground">
                              {items.find((i) => i.id === item.item_id)?.name ||
                                item.item_name ||
                                (item.item_id ? `Item #${item.item_id}` : '—')}
                            </td>
                            <td className="px-4 py-3 text-sm text-muted-foreground">{item.description || '—'}</td>
                            <td className="px-4 py-3 text-sm text-foreground text-right tabular-nums">
                              {formatNumber(Number(item.quantity))}
                            </td>
                            <td className="px-4 py-3 text-sm text-foreground text-right tabular-nums">
                              {currencySymbol}
                              {formatNumber(Number(item.unit_price || 0))}
                            </td>
                            <td className="px-4 py-3 text-sm font-medium text-foreground text-right tabular-nums">
                              {currencySymbol}
                              {formatNumber(Number(item.amount || 0))}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Totals */}
                <div className="border-t pt-4">
                  <div className="flex justify-end space-x-8">
                    <div className="text-right">
                      <p className="text-sm text-muted-foreground">Subtotal:</p>
                      <p className="text-sm text-muted-foreground">Tax:</p>
                      {viewingInvoice.discount_amount && viewingInvoice.discount_amount > 0 && (
                        <p className="text-sm text-muted-foreground">Discount:</p>
                      )}
                      <p className="text-lg font-semibold text-foreground">Total:</p>
                      {viewingInvoice.amount_paid && viewingInvoice.amount_paid > 0 && (
                        <>
                          <p className="text-sm text-muted-foreground mt-2">Amount Paid:</p>
                          <p className="text-sm text-muted-foreground">Balance Due:</p>
                        </>
                      )}
                    </div>
                    <div className="text-right min-w-[120px]">
                      <p className="text-sm text-foreground">{currencySymbol}{formatNumber(Number(viewingInvoice.subtotal || 0))}</p>
                      <p className="text-sm text-foreground">{currencySymbol}{formatNumber(Number(viewingInvoice.tax_amount || 0))}</p>
                      {viewingInvoice.discount_amount && viewingInvoice.discount_amount > 0 && (
                        <p className="text-sm text-foreground">{currencySymbol}{formatNumber(Number(viewingInvoice.discount_amount))}</p>
                      )}
                      <p className="text-lg font-semibold text-foreground">{currencySymbol}{formatNumber(Number(viewingInvoice.total_amount || 0))}</p>
                      {viewingInvoice.amount_paid && viewingInvoice.amount_paid > 0 && (
                        <>
                          <p className="text-sm text-foreground mt-2">{currencySymbol}{formatNumber(Number(viewingInvoice.amount_paid))}</p>
                          <p className="text-sm font-medium text-foreground">{currencySymbol}{formatNumber(Number(viewingInvoice.balance_due || 0))}</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={handleCloseViewModal}
                  className="px-4 py-2 bg-muted-foreground text-white rounded-lg hover:bg-muted-foreground"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Invoice Modal */}
        {showEditModal && editingInvoice && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
            <div className="bg-white rounded-lg app-modal-pad max-w-5xl w-full max-h-[90vh] overflow-y-auto my-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Edit Invoice {editingInvoice.invoice_number}</h2>
                <button
                  onClick={handleCloseEditModal}
                  className="text-muted-foreground/70 hover:text-muted-foreground"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <form onSubmit={handleUpdateInvoice}>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      Customer *
                    </label>
                    <CustomerReferenceCombobox
                      value={formData.customer_id}
                      onChange={(customerId) => setFormData({ ...formData, customer_id: customerId })}
                      customers={customers}
                      className="erp-field"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      Invoice Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={formData.invoice_date}
                      onChange={(e) => setFormData({ ...formData, invoice_date: e.target.value })}
                      className="erp-field"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      Due Date
                    </label>
                    <input
                      type="date"
                      value={formData.due_date}
                      onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                      className="erp-field"
                    />
                  </div>
                </div>

                {/* Line Items */}
                <div className="mb-6">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold">Line Items</h3>
                    <div className="flex items-center gap-2">
                      {items.length === 0 && !loadingItems && (
                        <button
                          type="button"
                          onClick={fetchCustomersAndItems}
                          className="flex items-center space-x-1 px-3 py-1 text-sm bg-muted-foreground text-white rounded-lg hover:bg-muted-foreground"
                          title="Reload items"
                        >
                          <span>Reload Items</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleAddLine}
                        className="flex items-center space-x-1 px-3 py-1 text-sm bg-primary text-white rounded-lg hover:bg-primary"
                      >
                        <PlusCircle className="h-4 w-4" />
                        <span>Add Line</span>
                      </button>
                    </div>
                  </div>

                  <InvoiceLineFormList
                    lines={formData.lines}
                    items={items}
                    stations={stations}
                    ponds={ponds}
                    pondIncomeCategories={pondIncomeCategories}
                    stationIncomeCategories={stationIncomeCategories}
                    revenueCoaOptions={revenueCoaOptions}
                    revenueRecommendLabel={invoiceRevenueRecommendLabel}
                    currencySymbol={currencySymbol}
                    loadingItems={loadingItems}
                    companyName={companyName}
                    onApplyItem={applyInvoiceLineFromPicker}
                    onLineChange={handleLineChange}
                    onLineBundle={handleLineBundle}
                    onRemoveLine={handleRemoveLine}
                    onChangeLineKind={handleChangeLineKind}
                  />

                  {formData.lines.length === 0 && (
                    <p className="text-center text-muted-foreground py-4">No line items added. Click "Add Line" to add items.</p>
                  )}
                </div>

                {/* Totals */}
                {formData.lines.length > 0 && (
                  <div className="border-t pt-4 mb-6">
                    <div className="flex justify-end space-x-8">
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">Subtotal:</p>
                        <p className="text-sm text-muted-foreground">Tax:</p>
                        <p className="text-lg font-semibold text-foreground">Total:</p>
                      </div>
                      <div className="text-right min-w-[9rem] tabular-nums">
                        <p className="text-sm text-foreground">{currencySymbol}{formatNumber(calculateTotals().subtotal)}</p>
                        <p className="text-sm text-foreground">{currencySymbol}{formatNumber(calculateTotals().taxAmount)}</p>
                        <p className="text-lg font-semibold text-foreground">{currencySymbol}{formatNumber(calculateTotals().total)}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Form Actions */}
                <div className="flex justify-end space-x-4">
                  <button
                    type="button"
                    onClick={handleCloseEditModal}
                    className="px-4 py-2 border border-border rounded-lg text-foreground/85 hover:bg-muted/40"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="erp-btn-primary"
                  >
                    Update Invoice
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
