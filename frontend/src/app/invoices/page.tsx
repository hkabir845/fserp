'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { Plus, Eye, Search, X, PlusCircle, Trash2, Send, CheckCircle, Edit2, FileText } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api, { getApiBaseUrl, getBackendOrigin } from '@/lib/api'
import { getCurrencySymbol } from '@/utils/currency'
import { formatDateOnly } from '@/utils/date'
import { AMOUNT_READ_ONLY_INPUT_CLASS } from '@/utils/amountFieldStyles'

interface InvoiceLineItem {
  id?: number
  line_number: number
  description?: string
  item_id?: number
  /** From API when item relation is present (POS / list detail). */
  item_name?: string
  quantity: number
  unit_price: number
  amount: number
  tax_amount: number
}

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
  const toast = useToast()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingItems, setLoadingItems] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)
  const [searchTerm, setSearchTerm] = useState('')
  const [sourceFilter, setSourceFilter] = useState<string>('all') // 'all', 'pos', 'manual'
  const [showModal, setShowModal] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null)
  const [viewingInvoice, setViewingInvoice] = useState<Invoice | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [currencySymbol, setCurrencySymbol] = useState<string>('৳') // Default to BDT
  const [formData, setFormData] = useState({
    customer_id: 0,
    invoice_date: new Date().toISOString().split('T')[0],
    due_date: '',
    lines: [] as InvoiceLineItem[]
  })

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    
    // Get user role from localStorage
    const userStr = localStorage.getItem('user')
    if (userStr) {
      try {
        const user = JSON.parse(userStr)
        setUserRole(user.role?.toLowerCase() || null)
      } catch (error) {
        console.error('Error parsing user data:', error)
      }
    }
    
    fetchData()
  }, [router, sourceFilter]) // Refetch when sourceFilter changes

  // Fetch customers and items when modal opens
  useEffect(() => {
    if (showModal || showEditModal) {
      // Always fetch to ensure fresh data
      fetchCustomersAndItems()
    }
  }, [showModal, showEditModal])

  const fetchData = async (isRetry = false) => {
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
        console.error('Error fetching company currency:', error)
        // Don't fail the whole fetch if currency fails
      }

      // Fetch invoices with proper error handling
      const includePos = sourceFilter === 'all' || sourceFilter === 'pos'
      
      // Use params object - axios will handle URL encoding and query string construction
      // Remove trailing slash to avoid issues with query params
      const response = await api.get('/invoices', {
        params: { include_pos: includePos }
      })
      
      // Handle response - axios wraps the response in response.data
      const invoicesData = response.data
      
      if (response.status === 200) {
        // Ensure we have an array
        if (Array.isArray(invoicesData)) {
          setInvoices(
            invoicesData.map((row: Record<string, unknown>) => normalizeInvoiceFromApi(row))
          )
          setError(null)
          setRetryCount(0)
        } else if (invoicesData && Array.isArray(invoicesData.data)) {
          // Handle case where data might be wrapped
          setInvoices(
            invoicesData.data.map((row: Record<string, unknown>) => normalizeInvoiceFromApi(row))
          )
          setError(null)
          setRetryCount(0)
        } else {
          const errorMsg = `Invalid response format: expected array of invoices, got ${typeof invoicesData}`
          console.error('Invalid response format:', {
            status: response.status,
            dataType: typeof invoicesData,
            data: invoicesData,
            keys: invoicesData ? Object.keys(invoicesData) : 'N/A'
          })
          setError(errorMsg)
          toast.error(errorMsg)
        }
      } else {
        const errorMsg = `Unexpected response status: ${response.status}`
        console.error('Failed to load invoices:', response.status, invoicesData)
        setError(errorMsg)
        toast.error(errorMsg)
      }
    } catch (error: any) {
      console.error('Error fetching invoices - Full error object:', {
        error,
        message: error.message,
        response: error.response,
        request: error.request,
        config: error.config,
        stack: error.stack
      })
      
      let errorMessage = 'Failed to load invoices'
      
      if (error.response) {
        // Server responded with error status
        const status = error.response.status
        const detail = error.response.data?.detail || error.response.data?.message || 'Unknown error'
        
        console.error('API Error Response:', {
          status,
          statusText: error.response.statusText,
          data: error.response.data,
          headers: error.response.headers
        })
        
        if (status === 401) {
          errorMessage = 'Authentication required. Please log in again.'
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
            errorMessage = `Permission Denied: ${permissionDetail}. Your current role (${currentRole}) does not have access to invoices. Required roles: Super Admin, Admin, Accountant, or Cashier. Please contact an administrator.`
          } else {
            errorMessage = `Permission Denied: ${permissionDetail || `You do not have permission to view invoices. Your current role (${currentRole}) is not authorized. Required roles: Super Admin, Admin, Accountant, or Cashier.`}`
          }
        } else if (status === 404) {
          errorMessage = 'Invoices endpoint not found. Please check if the backend is running correctly.'
        } else if (status === 500) {
          // Extract the actual error message from the detail
          let serverError = 'Unknown server error'
          if (typeof detail === 'string') {
            serverError = detail
          } else if (detail && typeof detail === 'object') {
            // Try to extract meaningful error message
            serverError = detail.message || detail.error || JSON.stringify(detail)
          }
          errorMessage = `Server error: ${serverError}`
          
          // If it's a schema/database error, provide helpful guidance
          if (serverError.toLowerCase().includes('no such column') || 
              serverError.toLowerCase().includes('operationalerror') ||
              serverError.toLowerCase().includes('schema')) {
            errorMessage = `Database schema error detected. The backend may need to apply database migrations. Error: ${serverError}`
          }
        } else {
          errorMessage = `Error ${status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`
        }
      } else if (error.request) {
        // Request made but no response
        console.error('No response received:', error.request)
        errorMessage = `Unable to connect to server. Please ensure the backend is running on ${getBackendOrigin()}`
      } else {
        // Error setting up request
        console.error('Request setup error:', error.message)
        errorMessage = error.message || 'An unexpected error occurred'
      }
      
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const handleRetry = () => {
    setRetryCount(prev => prev + 1)
    fetchData(true)
  }

  const fetchCustomersAndItems = async () => {
    setLoadingItems(true)
    try {
      const token = localStorage.getItem('access_token')
      if (!token) {
        toast.error('Authentication required')
        setLoadingItems(false)
        return
      }
      
      const baseUrl = getApiBaseUrl()
      
      // Fetch customers
      try {
        const customersResponse = await fetch(`${baseUrl}/customers/`, {
          headers: { 
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        })
        
        if (customersResponse.ok) {
          const customersData = await customersResponse.json()
          const activeCustomers = customersData.filter((c: Customer) => c.is_active)
          setCustomers(activeCustomers)
        } else {
          const errorData = await customersResponse.json().catch(() => ({}))
          console.error('Failed to load customers:', customersResponse.status, errorData)
          toast.error(errorData.detail || 'Failed to load customers')
        }
      } catch (error) {
        console.error('Error fetching customers:', error)
        toast.error('Failed to load customers')
      }
      
      // Fetch items
      try {
        const itemsResponse = await fetch(`${baseUrl}/items/`, {
          headers: { 
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        })
        
        if (itemsResponse.ok) {
          const itemsData = await itemsResponse.json()
          
          // Filter out deleted items and ensure we have valid items
          const validItems = Array.isArray(itemsData) 
            ? itemsData.filter((item: Item) => item && item.id && item.name && !item.is_deleted)
            : []
          
          setItems(validItems)
          
          if (validItems.length === 0) {
            console.warn('No valid items found. Raw data:', itemsData)
            toast.error('No items available. Please create items first.')
          }
        } else {
          const errorData = await itemsResponse.json().catch(() => ({}))
          console.error('Failed to load items:', itemsResponse.status, errorData)
          toast.error(errorData.detail || `Failed to load items (${itemsResponse.status})`)
        }
      } catch (error) {
        console.error('Error fetching items:', error)
        toast.error('Failed to load items. Check console for details.')
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

  const resolveInvoiceCustomerLabel = (invoice: Invoice): string => {
    const fromApi = (invoice.customer_name || '').trim()
    if (fromApi) return fromApi
    const c = customers.find((x) => x.id === invoice.customer_id)
    if (c) {
      const label = (c.display_name || c.company_name || c.customer_number || '').trim()
      if (label) return label
    }
    return invoice.customer_id ? `Customer #${invoice.customer_id}` : '—'
  }

  const filteredInvoices = invoices.filter((invoice) => {
    const displayNumber = getDisplayNumber(invoice)
    const q = searchTerm.toLowerCase()
    const matchesSearch =
      displayNumber.toLowerCase().includes(q) ||
      resolveInvoiceCustomerLabel(invoice).toLowerCase().includes(q)

    const matchesSource =
      sourceFilter === 'all' ||
      (sourceFilter === 'pos' &&
        (invoice.source === 'pos_fuel' ||
          invoice.source === 'pos_general' ||
          invoice.source === 'pos_mixed')) ||
      (sourceFilter === 'manual' && invoice.source === 'manual')
    return matchesSearch && matchesSource
  })

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'paid':
        return 'bg-green-100 text-green-800'
      case 'sent':
      case 'partially_paid':
        return 'bg-yellow-100 text-yellow-800'
      case 'overdue':
        return 'bg-red-100 text-red-800'
      case 'draft':
        return 'bg-gray-100 text-gray-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  const getSourceBadge = (source?: string) => {
    if (!source) return null
    const sourceMap: { [key: string]: { label: string; color: string } } = {
      'pos_fuel': { label: 'POS Fuel', color: 'bg-blue-100 text-blue-800' },
      'pos_general': { label: 'POS General', color: 'bg-purple-100 text-purple-800' },
      'pos_mixed': { label: 'POS Mixed', color: 'bg-indigo-100 text-indigo-800' },
      'manual': { label: 'Manual', color: 'bg-gray-100 text-gray-800' }
    }
    const sourceInfo = sourceMap[source] || { label: source, color: 'bg-gray-100 text-gray-800' }
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
    setFormData({
      ...formData,
      lines: [
        ...formData.lines,
        {
          line_number: formData.lines.length + 1,
          description: '',
          quantity: 1,
          unit_price: 0,
          amount: 0,
          tax_amount: 0
        }
      ]
    })
  }

  const handleRemoveLine = (index: number) => {
    const newLines = formData.lines.filter((_, i) => i !== index)
      .map((line, i) => ({ ...line, line_number: i + 1 }))
    setFormData({ ...formData, lines: newLines })
  }

  const handleLineChange = (index: number, field: string, value: any) => {
    const newLines = [...formData.lines]
    newLines[index] = { ...newLines[index], [field]: value }
    
    if (field === 'quantity' || field === 'unit_price') {
      const quantity = field === 'quantity' ? parseFloat(value) || 0 : newLines[index].quantity
      const unitPrice = field === 'unit_price' ? parseFloat(value) || 0 : newLines[index].unit_price
      newLines[index].amount = calculateLineAmount(quantity, unitPrice)
    }
    
    setFormData({ ...formData, lines: newLines })
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.customer_id || formData.customer_id === 0) {
      toast.error('Please select a customer')
      return
    }

    if (formData.lines.length === 0) {
      toast.error('Please add at least one line item')
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
        line_items: validLines.map((line) => {
          const quantity = parseFloat(line.quantity.toString())
          const unitPrice = parseFloat(line.unit_price.toString())
          
          // Validate each line item
          if (quantity <= 0) {
            throw new Error(`Line item ${validLines.indexOf(line) + 1}: Quantity must be greater than 0`)
          }
          if (unitPrice < 0) {
            throw new Error(`Line item ${validLines.indexOf(line) + 1}: Unit price cannot be negative`)
          }
          
          return {
            item_id: line.item_id && line.item_id > 0 ? line.item_id : null,
            description: line.description && line.description.trim() ? line.description.trim() : null,
            quantity: quantity,
            unit_price: unitPrice
          }
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
        toast.success('Invoice created successfully!')
        setShowModal(false)
        resetForm()
        fetchData()
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
        fetchData() // Refresh the invoice list
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

  const handleEditInvoice = async (invoice: Invoice) => {
    try {
      // Fetch full invoice details with line items
      const response = await api.get(`/invoices/${invoice.id}`)
      if (response.status === 200) {
        const fullInvoice = normalizeInvoiceFromApi(response.data as Record<string, unknown>)
        setEditingInvoice(fullInvoice)
        const li = fullInvoice.line_items || []
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
      toast.error('Please select a customer')
      return
    }

    if (formData.lines.length === 0) {
      toast.error('Please add at least one line item')
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
      const response = await api.put(`/invoices/${editingInvoice.id}`, {
        customer_id: formData.customer_id,
        invoice_date: formData.invoice_date,
        due_date: formData.due_date || null,
        line_items: validLines.map((line) => ({
          item_id: line.item_id && line.item_id > 0 ? line.item_id : null,
          description: line.description && line.description.trim() ? line.description.trim() : null,
          quantity: parseFloat(line.quantity.toString()) || 0,
          unit_price: parseFloat(line.unit_price.toString()) || 0
        }))
      })

      if (response.status === 200) {
        toast.success('Invoice updated successfully!')
        setShowEditModal(false)
        setEditingInvoice(null)
        resetForm()
        fetchData()
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

      if (response.status === 204) {
        toast.success(`Invoice ${invoiceNumber} deleted successfully!`)
        fetchData() // Refresh the invoice list
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

  const isAdmin = userRole === 'admin'

  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto p-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Invoices</h1>
          <p className="text-gray-600 mt-1">Manage customer invoices</p>
        </div>

        <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
          <div className="flex items-center gap-4 flex-1 min-w-[300px]">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
              <input
                type="text"
                placeholder="Search by invoice number..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-sm"
              />
            </div>
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-sm bg-white"
            >
              <option value="all">All Invoices</option>
              <option value="pos">POS Invoices</option>
              <option value="manual">Manual Invoices</option>
            </select>
          </div>
          <button
            onClick={handleOpenModal}
            className="flex items-center space-x-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all shadow-md hover:shadow-lg font-medium"
          >
            <Plus className="h-5 w-5" />
            <span>New Invoice</span>
          </button>
        </div>

        {loading ? (
          <div className="flex flex-col justify-center items-center h-64 bg-white rounded-lg shadow">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
            <p className="text-gray-600">Loading invoices...</p>
          </div>
        ) : error ? (
          <div className="bg-white rounded-lg shadow p-8">
            <div className="flex flex-col items-center justify-center text-center">
              <div className="bg-red-100 rounded-full p-4 mb-4">
                <FileText className="h-12 w-12 text-red-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Unable to Load Invoices</h3>
              <p className="text-gray-600 mb-6 max-w-md">{error}</p>
              <div className="flex gap-3">
                <button
                  onClick={handleRetry}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                >
                  <span>Retry</span>
                  {retryCount > 0 && <span className="text-sm opacity-75">({retryCount})</span>}
                </button>
                <button
                  onClick={() => fetchData(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Refresh
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Invoice #
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Source
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Due Date
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Customer
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Subtotal
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Tax
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Total
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredInvoices.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-6 py-16 text-center">
                        <div className="flex flex-col items-center">
                          <div className="bg-gray-100 rounded-full p-4 mb-4">
                            <FileText className="h-10 w-10 text-gray-400" />
                          </div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Invoices Found</h3>
                          <p className="text-gray-600 mb-4 max-w-sm">
                            {sourceFilter !== 'all' 
                              ? `No invoices found for the selected filter (${sourceFilter}). Try selecting "All Invoices" or create a new invoice.`
                              : "You haven't created any invoices yet. Create your first invoice to get started."}
                          </p>
                          {sourceFilter === 'all' && (
                            <button
                              onClick={handleOpenModal}
                              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2"
                            >
                              <Plus className="h-5 w-5" />
                              <span>Create First Invoice</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    filteredInvoices.map((invoice) => (
                    <tr key={invoice.id} className="hover:bg-blue-50 transition-colors border-b border-gray-100">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-semibold text-gray-900">
                          {getDisplayNumber(invoice)}
                        </div>
                        {invoice.source && (invoice.source === 'pos_fuel' || invoice.source === 'pos_general' || invoice.source === 'pos_mixed') && invoice.invoice_number && invoice.invoice_number !== invoice.pos_receipt_number && (
                          <div className="text-xs text-gray-500 mt-1">
                            Invoice: {invoice.invoice_number}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {getSourceBadge(invoice.source)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {formatDateOnly(invoice.invoice_date)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                        {invoice.due_date ? formatDateOnly(invoice.due_date) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900 max-w-[14rem]">
                        <span className="line-clamp-2" title={resolveInvoiceCustomerLabel(invoice)}>
                          {resolveInvoiceCustomerLabel(invoice)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-900">
                        {currencySymbol}{Number(invoice.subtotal || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-900">
                        {currencySymbol}{Number(invoice.tax_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-gray-900">
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
                              className="p-2 text-green-600 hover:text-green-700 hover:bg-green-50 rounded-lg transition-colors"
                              title="Post Invoice (Change status to SENT)"
                            >
                              <Send className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            onClick={() => handleViewInvoice(invoice.id)}
                            className="p-2 text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors"
                            title="View Invoice"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          {isAdmin && invoice.status !== 'void' && (
                            <>
                              <button
                                onClick={() => handleEditInvoice(invoice)}
                                disabled={invoice.status === 'paid' || invoice.status === 'partially_paid'}
                                className={`p-2 rounded-lg transition-colors ${
                                  invoice.status === 'paid' || invoice.status === 'partially_paid'
                                    ? 'text-gray-400 cursor-not-allowed'
                                    : 'text-blue-600 hover:text-blue-700 hover:bg-blue-50'
                                }`}
                                title={invoice.status === 'paid' || invoice.status === 'partially_paid' ? 'Cannot edit paid invoice' : 'Edit Invoice'}
                              >
                                <Edit2 className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteInvoice(invoice.id, invoice.invoice_number)}
                                className="p-2 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                                title="Delete Invoice"
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
            {filteredInvoices.length > 0 && (
              <div className="bg-gray-50 px-6 py-3 border-t border-gray-200">
                <p className="text-sm text-gray-600">
                  Showing <span className="font-semibold">{filteredInvoices.length}</span> of <span className="font-semibold">{invoices.length}</span> invoice{invoices.length !== 1 ? 's' : ''}
                  {searchTerm && ` matching "${searchTerm}"`}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Create Invoice Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
            <div className="bg-white rounded-lg p-8 max-w-5xl w-full max-h-[90vh] overflow-y-auto my-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Add New Invoice</h2>
                <button
                  onClick={handleCloseModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <form onSubmit={handleCreate}>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Customer *
                    </label>
                    <select
                      required
                      value={formData.customer_id}
                      onChange={(e) => setFormData({ ...formData, customer_id: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="0">Select Customer</option>
                      {customers.length === 0 ? (
                        <option value="0" disabled>Loading customers...</option>
                      ) : (
                        customers.map((customer) => (
                          <option key={customer.id} value={customer.id}>
                            {customer.display_name} ({customer.customer_number})
                          </option>
                        ))
                      )}
                    </select>
                    {customers.length === 0 && (
                      <p className="mt-1 text-xs text-red-600">
                        No active customers found. Please create a customer first.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Invoice Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={formData.invoice_date}
                      onChange={(e) => setFormData({ ...formData, invoice_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Due Date
                    </label>
                    <input
                      type="date"
                      value={formData.due_date}
                      onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
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
                          className="flex items-center space-x-1 px-3 py-1 text-sm bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                          title="Reload items"
                        >
                          <span>Reload Items</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleAddLine}
                        className="flex items-center space-x-1 px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                      >
                        <PlusCircle className="h-4 w-4" />
                        <span>Add Line</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {formData.lines.map((line, index) => (
                      <div key={index} className="grid grid-cols-12 gap-2 p-3 border border-gray-200 rounded-lg">
                        <div className="col-span-12 md:col-span-3">
                          <label className="block text-xs font-medium text-gray-700 mb-1">Item</label>
                          <select
                            value={line.item_id || ''}
                            onChange={(e) => {
                              const selectedValue = e.target.value
                              
                              if (!selectedValue || selectedValue === '') {
                                handleLineChange(index, 'item_id', undefined)
                                handleLineChange(index, 'unit_price', 0)
                                handleLineChange(index, 'description', '')
                                return
                              }
                              
                              const itemId = parseInt(selectedValue)
                              if (isNaN(itemId) || itemId === 0) {
                                console.warn('Invalid item ID:', selectedValue)
                                return
                              }
                              
                              const item = items.find(i => i.id === itemId)
                              
                              if (item) {
                                // Set unit_price, defaulting to 0 if null/undefined
                                const unitPrice = item.unit_price != null && item.unit_price !== undefined 
                                  ? parseFloat(item.unit_price.toString()) 
                                  : 0
                                
                                // Update all fields at once
                                const newLines = [...formData.lines]
                                newLines[index] = {
                                  ...newLines[index],
                                  item_id: itemId,
                                  unit_price: unitPrice,
                                  description: item.name || '',
                                  amount: calculateLineAmount(newLines[index].quantity || 1, unitPrice)
                                }
                                setFormData({ ...formData, lines: newLines })
                                
                                if (unitPrice === 0) {
                                  toast.warning(`Item "${item.name}" has no unit price set. Please enter a price manually.`)
                                }
                              } else {
                                console.error('Item not found. Item ID:', itemId, 'Available items:', items.map(i => ({ id: i.id, name: i.name })))
                                toast.error(`Item with ID ${itemId} not found`)
                              }
                            }}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                            disabled={loadingItems}
                          >
                            <option value="">Select Item...</option>
                            {loadingItems ? (
                              <option value="" disabled>Loading items...</option>
                            ) : items.length === 0 ? (
                              <option value="" disabled>No items available</option>
                            ) : (
                              items.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name} {item.item_number ? `(${item.item_number})` : ''}
                                </option>
                              ))
                            )}
                          </select>
                          {loadingItems && (
                            <p className="mt-1 text-xs text-gray-500">Loading items...</p>
                          )}
                          {!loadingItems && items.length === 0 && (
                            <p className="mt-1 text-xs text-red-600">
                              No items available. Please create items first.
                            </p>
                          )}
                        </div>
                        <div className="col-span-12 md:col-span-2">
                          <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                          <input
                            type="text"
                            value={line.description || ''}
                            onChange={(e) => handleLineChange(index, 'description', e.target.value)}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                        <div className="col-span-6 md:col-span-2">
                          <label className="block text-xs font-medium text-gray-700 mb-1">Quantity</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={line.quantity}
                            onChange={(e) => handleLineChange(index, 'quantity', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                        <div className="col-span-6 md:col-span-2">
                          <label className="block text-xs font-medium text-gray-700 mb-1">Unit Price</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={line.unit_price}
                            onChange={(e) => handleLineChange(index, 'unit_price', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                        <div className="col-span-12 md:col-span-2">
                          <label className="block text-xs font-medium text-gray-700 mb-1">Amount</label>
                          <input
                            type="text"
                            value={line.amount.toFixed(2)}
                            readOnly
                            title={`${currencySymbol}${line.amount.toFixed(2)}`}
                            className={AMOUNT_READ_ONLY_INPUT_CLASS}
                          />
                        </div>
                        <div className="col-span-12 md:col-span-1 flex items-end">
                          <button
                            type="button"
                            onClick={() => handleRemoveLine(index)}
                            className="w-full px-2 py-1 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="h-4 w-4 mx-auto" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {formData.lines.length === 0 && (
                    <p className="text-center text-gray-500 py-4">No line items added. Click "Add Line" to add items.</p>
                  )}
                </div>

                {/* Totals */}
                {formData.lines.length > 0 && (
                  <div className="border-t pt-4 mb-6">
                    <div className="flex justify-end space-x-8">
                      <div className="text-right">
                        <p className="text-sm text-gray-600">Subtotal:</p>
                        <p className="text-sm text-gray-600">Tax:</p>
                        <p className="text-lg font-semibold text-gray-900">Total:</p>
                      </div>
                      <div className="text-right min-w-[9rem] tabular-nums">
                        <p className="text-sm text-gray-900">{currencySymbol}{calculateTotals().subtotal.toFixed(2)}</p>
                        <p className="text-sm text-gray-900">{currencySymbol}{calculateTotals().taxAmount.toFixed(2)}</p>
                        <p className="text-lg font-semibold text-gray-900">{currencySymbol}{calculateTotals().total.toFixed(2)}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Form Actions */}
                <div className="flex justify-end space-x-4">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
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
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
            <div className="bg-white rounded-lg p-8 max-w-4xl w-full max-h-[90vh] overflow-y-auto my-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Invoice Details</h2>
                <button
                  onClick={handleCloseViewModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="space-y-6">
                {/* Invoice Header */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-gray-600">Invoice Number</p>
                    <p className="text-lg font-semibold">{getDisplayNumber(viewingInvoice)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Status</p>
                    <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(viewingInvoice.status)}`}>
                      {viewingInvoice.status.charAt(0).toUpperCase() + viewingInvoice.status.slice(1).replace('_', ' ')}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Invoice Date</p>
                    <p className="text-lg">{formatDateOnly(viewingInvoice.invoice_date)}</p>
                  </div>
                  {viewingInvoice.due_date && (
                    <div>
                      <p className="text-sm text-gray-600">Due Date</p>
                      <p className="text-lg">{formatDateOnly(viewingInvoice.due_date)}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-sm text-gray-600">Customer</p>
                    <p className="text-lg font-medium text-gray-900">{resolveInvoiceCustomerLabel(viewingInvoice)}</p>
                  </div>
                </div>

                {/* Line Items */}
                <div>
                  <h3 className="text-lg font-semibold mb-4">Line Items</h3>
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Item</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Quantity</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Unit Price</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {(viewingInvoice.line_items?.length ?? 0) === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-500">
                            No line items on this invoice.
                          </td>
                        </tr>
                      ) : (
                        viewingInvoice.line_items!.map((item: InvoiceLineItem, idx: number) => (
                          <tr key={item.id ?? `line-${idx}`}>
                            <td className="px-4 py-3 text-sm text-gray-900">
                              {items.find((i) => i.id === item.item_id)?.name ||
                                item.item_name ||
                                (item.item_id ? `Item #${item.item_id}` : '—')}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">{item.description || '—'}</td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">
                              {Number(item.quantity).toFixed(2)}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900 text-right tabular-nums">
                              {currencySymbol}
                              {Number(item.unit_price || 0).toFixed(2)}
                            </td>
                            <td className="px-4 py-3 text-sm font-medium text-gray-900 text-right tabular-nums">
                              {currencySymbol}
                              {Number(item.amount || 0).toFixed(2)}
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
                      <p className="text-sm text-gray-600">Subtotal:</p>
                      <p className="text-sm text-gray-600">Tax:</p>
                      {viewingInvoice.discount_amount && viewingInvoice.discount_amount > 0 && (
                        <p className="text-sm text-gray-600">Discount:</p>
                      )}
                      <p className="text-lg font-semibold text-gray-900">Total:</p>
                      {viewingInvoice.amount_paid && viewingInvoice.amount_paid > 0 && (
                        <>
                          <p className="text-sm text-gray-600 mt-2">Amount Paid:</p>
                          <p className="text-sm text-gray-600">Balance Due:</p>
                        </>
                      )}
                    </div>
                    <div className="text-right min-w-[120px]">
                      <p className="text-sm text-gray-900">{currencySymbol}{Number(viewingInvoice.subtotal || 0).toFixed(2)}</p>
                      <p className="text-sm text-gray-900">{currencySymbol}{Number(viewingInvoice.tax_amount || 0).toFixed(2)}</p>
                      {viewingInvoice.discount_amount && viewingInvoice.discount_amount > 0 && (
                        <p className="text-sm text-gray-900">{currencySymbol}{Number(viewingInvoice.discount_amount).toFixed(2)}</p>
                      )}
                      <p className="text-lg font-semibold text-gray-900">{currencySymbol}{Number(viewingInvoice.total_amount || 0).toFixed(2)}</p>
                      {viewingInvoice.amount_paid && viewingInvoice.amount_paid > 0 && (
                        <>
                          <p className="text-sm text-gray-900 mt-2">{currencySymbol}{Number(viewingInvoice.amount_paid).toFixed(2)}</p>
                          <p className="text-sm font-medium text-gray-900">{currencySymbol}{Number(viewingInvoice.balance_due || 0).toFixed(2)}</p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={handleCloseViewModal}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
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
            <div className="bg-white rounded-lg p-8 max-w-5xl w-full max-h-[90vh] overflow-y-auto my-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold">Edit Invoice {editingInvoice.invoice_number}</h2>
                <button
                  onClick={handleCloseEditModal}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <form onSubmit={handleUpdateInvoice}>
                <div className="grid grid-cols-2 gap-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Customer *
                    </label>
                    <select
                      required
                      value={formData.customer_id}
                      onChange={(e) => setFormData({ ...formData, customer_id: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="0">Select Customer</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.display_name} ({customer.customer_number})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Invoice Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={formData.invoice_date}
                      onChange={(e) => setFormData({ ...formData, invoice_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Due Date
                    </label>
                    <input
                      type="date"
                      value={formData.due_date}
                      onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
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
                          className="flex items-center space-x-1 px-3 py-1 text-sm bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                          title="Reload items"
                        >
                          <span>Reload Items</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={handleAddLine}
                        className="flex items-center space-x-1 px-3 py-1 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                      >
                        <PlusCircle className="h-4 w-4" />
                        <span>Add Line</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {formData.lines.map((line, index) => (
                      <div key={index} className="grid grid-cols-12 gap-2 p-3 border border-gray-200 rounded-lg">
                        <div className="col-span-12 md:col-span-3">
                          <label className="block text-xs font-medium text-gray-700 mb-1">Item</label>
                          <select
                            value={line.item_id || ''}
                            onChange={(e) => {
                              const selectedValue = e.target.value
                              
                              if (!selectedValue || selectedValue === '') {
                                handleLineChange(index, 'item_id', undefined)
                                handleLineChange(index, 'unit_price', 0)
                                handleLineChange(index, 'description', '')
                                return
                              }
                              
                              const itemId = parseInt(selectedValue)
                              if (isNaN(itemId) || itemId === 0) {
                                console.warn('Invalid item ID:', selectedValue)
                                return
                              }
                              
                              const item = items.find(i => i.id === itemId)
                              
                              if (item) {
                                // Set unit_price, defaulting to 0 if null/undefined
                                const unitPrice = item.unit_price != null && item.unit_price !== undefined 
                                  ? parseFloat(item.unit_price.toString()) 
                                  : 0
                                
                                // Update all fields at once
                                const newLines = [...formData.lines]
                                newLines[index] = {
                                  ...newLines[index],
                                  item_id: itemId,
                                  unit_price: unitPrice,
                                  description: item.name || '',
                                  amount: calculateLineAmount(newLines[index].quantity || 1, unitPrice)
                                }
                                setFormData({ ...formData, lines: newLines })
                                
                                if (unitPrice === 0) {
                                  toast.warning(`Item "${item.name}" has no unit price set. Please enter a price manually.`)
                                }
                              } else {
                                console.error('Item not found. Item ID:', itemId, 'Available items:', items.map(i => ({ id: i.id, name: i.name })))
                                toast.error(`Item with ID ${itemId} not found`)
                              }
                            }}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                            disabled={loadingItems}
                          >
                            <option value="">Select Item...</option>
                            {loadingItems ? (
                              <option value="" disabled>Loading items...</option>
                            ) : items.length === 0 ? (
                              <option value="" disabled>No items available</option>
                            ) : (
                              items.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name} {item.item_number ? `(${item.item_number})` : ''}
                                </option>
                              ))
                            )}
                          </select>
                          {loadingItems && (
                            <p className="mt-1 text-xs text-gray-500">Loading items...</p>
                          )}
                          {!loadingItems && items.length === 0 && (
                            <p className="mt-1 text-xs text-red-600">
                              No items available. Please create items first.
                            </p>
                          )}
                        </div>
                        <div className="col-span-12 md:col-span-2">
                          <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                          <input
                            type="text"
                            value={line.description || ''}
                            onChange={(e) => handleLineChange(index, 'description', e.target.value)}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                        <div className="col-span-6 md:col-span-2">
                          <label className="block text-xs font-medium text-gray-700 mb-1">Quantity</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={line.quantity}
                            onChange={(e) => handleLineChange(index, 'quantity', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                        <div className="col-span-6 md:col-span-2">
                          <label className="block text-xs font-medium text-gray-700 mb-1">Unit Price</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={line.unit_price}
                            onChange={(e) => handleLineChange(index, 'unit_price', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                        <div className="col-span-12 md:col-span-2">
                          <label className="block text-xs font-medium text-gray-700 mb-1">Amount</label>
                          <input
                            type="text"
                            value={line.amount.toFixed(2)}
                            readOnly
                            title={`${currencySymbol}${line.amount.toFixed(2)}`}
                            className={AMOUNT_READ_ONLY_INPUT_CLASS}
                          />
                        </div>
                        <div className="col-span-12 md:col-span-1 flex items-end">
                          <button
                            type="button"
                            onClick={() => handleRemoveLine(index)}
                            className="w-full px-2 py-1 text-sm text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                          >
                            <Trash2 className="h-4 w-4 mx-auto" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {formData.lines.length === 0 && (
                    <p className="text-center text-gray-500 py-4">No line items added. Click "Add Line" to add items.</p>
                  )}
                </div>

                {/* Totals */}
                {formData.lines.length > 0 && (
                  <div className="border-t pt-4 mb-6">
                    <div className="flex justify-end space-x-8">
                      <div className="text-right">
                        <p className="text-sm text-gray-600">Subtotal:</p>
                        <p className="text-sm text-gray-600">Tax:</p>
                        <p className="text-lg font-semibold text-gray-900">Total:</p>
                      </div>
                      <div className="text-right min-w-[9rem] tabular-nums">
                        <p className="text-sm text-gray-900">{currencySymbol}{calculateTotals().subtotal.toFixed(2)}</p>
                        <p className="text-sm text-gray-900">{currencySymbol}{calculateTotals().taxAmount.toFixed(2)}</p>
                        <p className="text-lg font-semibold text-gray-900">{currencySymbol}{calculateTotals().total.toFixed(2)}</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Form Actions */}
                <div className="flex justify-end space-x-4">
                  <button
                    type="button"
                    onClick={handleCloseEditModal}
                    className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    Update Invoice
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
