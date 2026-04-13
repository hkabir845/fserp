'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { Plus, Edit, Trash2, Search, AlertTriangle, RefreshCw, Users, UserCheck, DollarSign, X, Mail, Phone, ArrowUpDown, ArrowUp, ArrowDown, Download, BookOpen } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api, { getApiBaseUrl, getApiDocsUrl, getBackendOrigin } from '@/lib/api'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { isConnectionError } from '@/utils/connectionError'

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
}

export default function CustomersPage() {
  const router = useRouter()
  const toast = useToast()
  const backendOrigin = getBackendOrigin()
  const apiDocsUrl = getApiDocsUrl()
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null)
  const [currencySymbol, setCurrencySymbol] = useState<string>('৳') // Default to BDT
  const [sortField, setSortField] = useState<keyof Customer | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [showDebug, setShowDebug] = useState(false)
  const [apiResponse, setApiResponse] = useState<any>(null)
  const [addingDummy, setAddingDummy] = useState(false)
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
    is_active: true
  })

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    
    // Fetch customers directly - error handling will show if backend is down
    fetchCustomers()
  }, [router])

  const fetchCustomers = async () => {
    setLoading(true)
    setError(null)
    try {
      // Fetch company currency (with shorter timeout and don't block on it)
      try {
        const companyRes = await Promise.race([
          api.get('/companies/current', { timeout: 5000 }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
        ]) as any
        if (companyRes?.data?.currency) {
          setCurrencySymbol(getCurrencySymbol(companyRes.data.currency))
        }
      } catch (error) {
        // Silently handle connection errors - backend may not be running
        if (!isConnectionError(error)) {
          console.warn('Error fetching company currency (non-critical):', error)
        }
        // Don't fail the whole request if currency fetch fails
      }

      // Fetch ALL customers using the api helper with high limit
      try {
        // Fetch customers with a reasonable timeout
        const customersPromise = api.get('/customers/?skip=0&limit=10000', {
          timeout: 15000 // 15 second timeout for this specific request
        })
        
        const response = await customersPromise
        const data = response.data
        
        // Store API response for debugging
        setApiResponse({ data, status: response.status, headers: response.headers })
        
        // Ensure data is an array
        if (Array.isArray(data)) {
          setCustomers(data)
          setError(null)
          if (data.length === 0) {
            console.warn('No customers found in database')
            toast.info('No customers found in the database. You can add your first customer using the "Add Customer" button.')
          }
        } else {
          console.error('Invalid data format received:', data)
          setError('Invalid data format received from server')
          setCustomers([])
          toast.error('Received invalid data format from server')
        }
      } catch (apiError: any) {
        console.error('API Error fetching customers:', apiError)
        
        // Handle timeout errors specifically
        if (apiError.code === 'ECONNABORTED' || apiError.message?.includes('timeout') || apiError.message?.includes('exceeded')) {
          const errorMsg = 'Backend server is not responding (timeout). The backend may be:\n' +
            '• Not running - Please start the backend server\n' +
            '• Frozen/hanging - Check backend logs for errors\n' +
            '• Database connection issues - Check database is running\n\n' +
            `Please check the backend console and ensure it's running on ${backendOrigin}`
          setError(errorMsg)
          toast.error('Backend timeout - Server may not be running. Check backend console.', 10000)
          setCustomers([])
          return
        }
        
        // Handle authentication errors
        if (apiError.response?.status === 401 || apiError.response?.status === 403) {
          localStorage.removeItem('access_token')
          router.push('/login')
          return
        }
        
        // Handle connection errors
        if (!apiError.response && (apiError.code === 'ECONNREFUSED' || apiError.message?.includes('Network Error') || apiError.message?.includes('Failed to fetch'))) {
          const errorMsg = 'Cannot connect to backend server.\n\n' +
            'Please ensure:\n' +
            `• Backend is running on ${backendOrigin}\n` +
            '• No firewall is blocking the connection\n' +
            '• Check backend console for startup errors'
          setError(errorMsg)
          toast.error('Cannot connect to backend. Is it running?', 10000)
          setCustomers([])
          return
        }
        
        // Handle other API errors
        const errorMsg = apiError.response?.data?.detail || apiError.message || 'Failed to load customers'
        setError(errorMsg)
        toast.error(errorMsg)
        setCustomers([])
      }
    } catch (error) {
      console.error('Unexpected error fetching customers:', error)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      let userMessage = 'Error connecting to server'
      
      if (errorMessage.includes('fetch') || errorMessage.includes('Failed to fetch')) {
        userMessage = `Cannot connect to backend server. Please ensure the backend is running on ${backendOrigin}`
      } else {
        userMessage = `Error: ${errorMessage}`
      }
      
      setError(userMessage)
      toast.error(userMessage)
      setCustomers([])
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const token = localStorage.getItem('access_token')
      const baseUrl = getApiBaseUrl()
      const response = await fetch(`${baseUrl}/customers/`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
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
          is_active: formData.is_active
        })
      })
      if (response.ok) {
        toast.success('Customer created successfully!')
        setShowModal(false)
        fetchCustomers()
        resetForm()
      } else {
        const error = await response.json().catch(() => ({ detail: 'Failed to create customer' }))
        console.error('Failed to create customer:', error)
        toast.error(error.detail || 'Failed to create customer')
      }
    } catch (error) {
      console.error('Error creating customer:', error)
      toast.error('Error connecting to server')
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
      is_active: customer.is_active
    })
    setShowModal(true)
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingCustomer) return

    try {
      const token = localStorage.getItem('access_token')
      const baseUrl = getApiBaseUrl()
      const response = await fetch(`${baseUrl}/customers/${editingCustomer.id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
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
          opening_balance_date: formData.opening_balance_date || null
        })
      })
      if (response.ok) {
        toast.success('Customer updated successfully!')
        setShowModal(false)
        setEditingCustomer(null)
        fetchCustomers()
        resetForm()
      } else {
        const error = await response.json().catch(() => ({ detail: 'Failed to update customer' }))
        console.error('Failed to update customer:', error)
        toast.error(error.detail || 'Failed to update customer')
      }
    } catch (error) {
      console.error('Error updating customer:', error)
      toast.error('Error connecting to server')
    }
  }

  const handleAddDummyCustomers = async () => {
    if (!confirm('This will add 12 dummy customers (3 cash customers and 9 credit customers) to the database. Continue?')) {
      return
    }
    
    setAddingDummy(true)
    try {
      const response = await api.post('/customers/add-dummy')
      const newCustomers = response.data
      toast.success(`Successfully added ${newCustomers.length} dummy customers!`)
      // Refresh the customer list
      await fetchCustomers()
    } catch (error: any) {
      console.error('Error adding dummy customers:', error)
      const errorMsg = error.response?.data?.detail || error.message || 'Failed to add dummy customers'
      toast.error(errorMsg)
    } finally {
      setAddingDummy(false)
    }
  }

  const handleDelete = async (customerId: number) => {
    try {
      const token = localStorage.getItem('access_token')
      const baseUrl = getApiBaseUrl()
      const response = await fetch(`${baseUrl}/customers/${customerId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      })
      if (response.ok || response.status === 204) {
        toast.success('Customer deleted successfully!')
        setShowDeleteConfirm(null)
        fetchCustomers()
      } else {
        const error = await response.json().catch(() => ({ detail: 'Failed to delete customer' }))
        console.error('Failed to delete customer:', error)
        toast.error(error.detail || 'Failed to delete customer')
      }
    } catch (error) {
      console.error('Error deleting customer:', error)
      toast.error('Error connecting to server')
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
      is_active: true
    })
    setEditingCustomer(null)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    resetForm()
  }

  const handleSort = (field: keyof Customer) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

  const filteredAndSortedCustomers = customers
    .filter(customer => {
      if (!searchTerm.trim()) return true
      
      const searchLower = searchTerm.toLowerCase()
      const displayName = (customer.display_name || '').toLowerCase()
      const email = (customer.email || '').toLowerCase()
      const customerNumber = (customer.customer_number || '').toLowerCase()
      const phone = (customer.phone || '').toLowerCase()
      
      return (
        displayName.includes(searchLower) ||
        email.includes(searchLower) ||
        customerNumber.includes(searchLower) ||
        phone.includes(searchLower)
      )
    })
    .sort((a, b) => {
      if (!sortField) return 0
      
      let aValue: any = a[sortField]
      let bValue: any = b[sortField]
      
      // Handle null/undefined values
      if (aValue == null) aValue = ''
      if (bValue == null) bValue = ''
      
      // Handle numbers
      if (sortField === 'current_balance' || sortField === 'opening_balance') {
        aValue = Number(aValue || 0)
        bValue = Number(bValue || 0)
      } else {
        // Handle strings
        aValue = String(aValue).toLowerCase()
        bValue = String(bValue).toLowerCase()
      }
      
      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1
      return 0
    })

  // Calculate statistics
  const totalCustomers = customers.length
  const activeCustomers = customers.filter(c => c.is_active).length
  const totalBalance = customers.reduce((sum, c) => sum + Number(c.current_balance || 0), 0)
  const totalReceivable = customers.filter(c => Number(c.current_balance || 0) > 0)
    .reduce((sum, c) => sum + Number(c.current_balance || 0), 0)

  const SortIcon = ({ field }: { field: keyof Customer }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="h-4 w-4 ml-1 text-gray-400" />
    }
    return sortDirection === 'asc' 
      ? <ArrowUp className="h-4 w-4 ml-1 text-blue-600" />
      : <ArrowDown className="h-4 w-4 ml-1 text-blue-600" />
  }

  return (
    <CompanyProvider>
      <div className="page-with-sidebar flex h-screen bg-gray-50">
        <Sidebar />
        <div className="flex-1 overflow-auto">
          <div className="p-8">
            {/* Header */}
            <div className="mb-8">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-3xl font-bold text-gray-900 mb-2">Customers</h1>
                  <p className="text-gray-600">Manage your customer accounts and track receivables</p>
                </div>
                <button
                  onClick={() => setShowDebug(!showDebug)}
                  className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
                  title="Toggle debug info"
                >
                  {showDebug ? 'Hide' : 'Show'} Debug
                </button>
              </div>
              {showDebug && (
                <div className="mt-4 p-4 bg-gray-100 rounded-lg text-xs font-mono">
                  <div className="mb-2"><strong>Total Customers:</strong> {totalCustomers}</div>
                  <div className="mb-2"><strong>Filtered:</strong> {filteredAndSortedCustomers.length}</div>
                  <div className="mb-2"><strong>API Response:</strong> {apiResponse ? JSON.stringify(apiResponse, null, 2).substring(0, 500) : 'Not loaded yet'}</div>
                  <div><strong>First Customer:</strong> {customers.length > 0 ? JSON.stringify(customers[0], null, 2).substring(0, 300) : 'None'}</div>
                </div>
              )}
            </div>

            {/* Statistics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-1">Total Customers</p>
                    <p className="text-2xl font-bold text-gray-900">{totalCustomers}</p>
                  </div>
                  <div className="bg-blue-100 rounded-full p-3">
                    <Users className="h-6 w-6 text-blue-600" />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-1">Active Customers</p>
                    <p className="text-2xl font-bold text-gray-900">{activeCustomers}</p>
                  </div>
                  <div className="bg-green-100 rounded-full p-3">
                    <UserCheck className="h-6 w-6 text-green-600" />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-1">Total Receivables</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {currencySymbol}{formatNumber(totalReceivable)}
                    </p>
                  </div>
                  <div className="bg-amber-100 rounded-full p-3">
                    <DollarSign className="h-6 w-6 text-amber-600" />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-lg shadow-sm p-6 border border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-600 mb-1">Net Balance</p>
                    <p className={`text-2xl font-bold ${totalBalance >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
                      {currencySymbol}{formatNumber(Math.abs(totalBalance))}
                    </p>
                  </div>
                  <div className={`rounded-full p-3 ${totalBalance >= 0 ? 'bg-gray-100' : 'bg-red-100'}`}>
                    <DollarSign className={`h-6 w-6 ${totalBalance >= 0 ? 'text-gray-600' : 'text-red-600'}`} />
                  </div>
                </div>
              </div>
            </div>

            {/* Search and Actions Bar */}
            <div className="bg-white rounded-lg shadow-sm p-4 mb-6 border border-gray-200">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="relative flex-1 w-full sm:max-w-md">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
                  <input
                    type="text"
                    placeholder="Search by name, email, phone, or customer number..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div className="flex items-center gap-3">
                  {totalCustomers === 0 && (
                    <button
                      onClick={handleAddDummyCustomers}
                      disabled={addingDummy}
                      className="flex items-center space-x-2 px-5 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors shadow-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Add 12 dummy customers (3 cash + 9 credit)"
                    >
                      {addingDummy ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                          <span>Adding...</span>
                        </>
                      ) : (
                        <>
                          <Users className="h-4 w-4" />
                          <span>Add Dummy Customers</span>
                        </>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      resetForm()
                      setShowModal(true)
                    }}
                    className="flex items-center space-x-2 px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors shadow-sm font-medium"
                  >
                    <Plus className="h-5 w-5" />
                    <span>Add Customer</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Content */}
            {loading ? (
              <div className="space-y-4">
                {/* Loading Skeleton */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <div className="animate-pulse space-y-4">
                    <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                    <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                    <div className="h-4 bg-gray-200 rounded w-5/6"></div>
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
                  <div className="animate-pulse">
                    <div className="h-12 bg-gray-100"></div>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className="h-16 border-b border-gray-200 bg-white"></div>
                    ))}
                  </div>
                </div>
              </div>
            ) : error ? (
              <div className="bg-red-50 border border-red-200 rounded-lg p-8">
                <div className="text-center mb-6">
                  <AlertTriangle className="h-16 w-16 text-red-600 mx-auto mb-4" />
                  <h3 className="text-xl font-bold text-red-800 mb-2">Backend Connection Error</h3>
                  <p className="text-red-700 whitespace-pre-line text-left max-w-2xl mx-auto mb-6">{error}</p>
                </div>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                  <button
                    onClick={fetchCustomers}
                    className="inline-flex items-center space-x-2 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                  >
                    <RefreshCw className="h-5 w-5" />
                    <span>Retry Connection</span>
                  </button>
                  <a
                    href={apiDocsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center space-x-2 px-6 py-3 border border-red-300 text-red-700 rounded-lg hover:bg-red-100 transition-colors font-medium"
                  >
                    <span>Check Backend Status</span>
                  </a>
                </div>
                <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-left max-w-2xl mx-auto">
                  <p className="text-sm text-yellow-800 font-semibold mb-2">💡 Troubleshooting Steps:</p>
                  <ol className="text-sm text-yellow-700 list-decimal list-inside space-y-1">
                    <li>Check if backend is running: Open {apiDocsUrl} (with Django DEBUG enabled)</li>
                    <li>Check backend console for errors or hanging processes</li>
                    <li>Restart the backend server if needed</li>
                    <li>Verify database connection in backend logs</li>
                  </ol>
                </div>
              </div>
            ) : filteredAndSortedCustomers.length === 0 ? (
              <div className="bg-white rounded-lg shadow-sm p-12 text-center border border-gray-200">
                <Users className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-gray-900 mb-2">
                  {searchTerm ? 'No customers found' : totalCustomers === 0 ? 'No customers in database' : 'No customers match your search'}
                </h3>
                <p className="text-gray-600 mb-6">
                  {searchTerm 
                    ? `Try adjusting your search terms. There are ${totalCustomers} total customers.`
                    : totalCustomers === 0
                    ? 'The database appears to be empty. Click below to add dummy customers (cash and credit) or add your first customer manually.'
                    : 'Get started by adding your first customer'}
                </p>
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  {!searchTerm && totalCustomers === 0 && (
                    <button
                      onClick={handleAddDummyCustomers}
                      disabled={addingDummy}
                      className="inline-flex items-center space-x-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                    >
                      {addingDummy ? (
                        <>
                          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                          <span>Adding Dummy Customers...</span>
                        </>
                      ) : (
                        <>
                          <Users className="h-5 w-5" />
                          <span>Add Dummy Customers (12 customers)</span>
                        </>
                      )}
                    </button>
                  )}
                  {!searchTerm && (
                    <button
                      onClick={() => {
                        resetForm()
                        setShowModal(true)
                      }}
                      className="inline-flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                    >
                      <Plus className="h-5 w-5" />
                      <span>{totalCustomers === 0 ? 'Add Your First Customer' : 'Add New Customer'}</span>
                    </button>
                  )}
                  <button
                    onClick={fetchCustomers}
                    className="inline-flex items-center space-x-2 px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                  >
                    <RefreshCw className="h-5 w-5" />
                    <span>Refresh</span>
                  </button>
                </div>
                {totalCustomers === 0 && (
                  <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg text-left max-w-2xl mx-auto">
                    <p className="text-sm text-blue-800 mb-2">
                      <strong>💡 Quick Start:</strong> Click "Add Dummy Customers" to instantly populate your database with:
                    </p>
                    <ul className="text-sm text-blue-700 list-disc list-inside space-y-1">
                      <li>3 Cash customers (immediate payment, no balance)</li>
                      <li>9 Credit customers (with outstanding balances and payment terms)</li>
                    </ul>
                    <p className="text-xs text-blue-600 mt-3">
                      This is perfect for testing and demonstration purposes.
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white rounded-lg shadow-sm overflow-hidden border border-gray-200">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th 
                          className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                          onClick={() => handleSort('customer_number')}
                        >
                          <div className="flex items-center">
                            Customer #
                            <SortIcon field="customer_number" />
                          </div>
                        </th>
                        <th 
                          className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                          onClick={() => handleSort('display_name')}
                        >
                          <div className="flex items-center">
                            Name
                            <SortIcon field="display_name" />
                          </div>
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Contact
                        </th>
                        <th 
                          className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                          onClick={() => handleSort('current_balance')}
                        >
                          <div className="flex items-center justify-end">
                            Balance
                            <SortIcon field="current_balance" />
                          </div>
                        </th>
                        <th 
                          className="px-6 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors"
                          onClick={() => handleSort('is_active')}
                        >
                          <div className="flex items-center justify-center">
                            Status
                            <SortIcon field="is_active" />
                          </div>
                        </th>
                        <th className="px-6 py-4 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {filteredAndSortedCustomers.map((customer) => {
                        const balance = Number(customer.current_balance || 0)
                        return (
                          <tr key={customer.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="text-sm font-medium text-gray-900">
                                {customer.customer_number}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <div className="text-sm font-medium text-gray-900">
                                {customer.display_name || '-'}
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="space-y-1">
                                {customer.email && (
                                  <div className="flex items-center text-sm text-gray-600">
                                    <Mail className="h-3.5 w-3.5 mr-1.5 text-gray-400" />
                                    <span>{customer.email}</span>
                                  </div>
                                )}
                                {customer.phone && (
                                  <div className="flex items-center text-sm text-gray-600">
                                    <Phone className="h-3.5 w-3.5 mr-1.5 text-gray-400" />
                                    <span>{customer.phone}</span>
                                  </div>
                                )}
                                {!customer.email && !customer.phone && (
                                  <span className="text-sm text-gray-400">-</span>
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right">
                              <span className={`text-sm font-semibold ${
                                balance > 0 
                                  ? 'text-amber-600' 
                                  : balance < 0 
                                  ? 'text-green-600' 
                                  : 'text-gray-900'
                              }`}>
                                {balance > 0 ? '+' : ''}{currencySymbol}{formatNumber(Math.abs(balance))}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-center">
                              <span className={`inline-flex px-3 py-1 text-xs font-semibold rounded-full ${
                                customer.is_active 
                                  ? 'bg-green-100 text-green-800' 
                                  : 'bg-red-100 text-red-800'
                              }`}>
                                {customer.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                              <div className="flex items-center justify-end space-x-3">
                                <Link
                                  href={`/customers/${customer.id}/ledger`}
                                  className="text-emerald-600 hover:text-emerald-900 transition-colors"
                                  title="Customer ledger"
                                >
                                  <BookOpen className="h-4 w-4" />
                                </Link>
                                <button 
                                  onClick={() => handleEdit(customer)}
                                  className="text-blue-600 hover:text-blue-900 transition-colors"
                                  title="Edit customer"
                                >
                                  <Edit className="h-4 w-4" />
                                </button>
                                <button 
                                  onClick={() => setShowDeleteConfirm(customer.id)}
                                  className="text-red-600 hover:text-red-900 transition-colors"
                                  title="Delete customer"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {filteredAndSortedCustomers.length > 0 && (
                  <div className="bg-gray-50 px-6 py-4 border-t border-gray-200">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-gray-600">
                        Showing <span className="font-semibold">{filteredAndSortedCustomers.length}</span> of{' '}
                        <span className="font-semibold">{totalCustomers}</span> customers
                        {searchTerm && ` matching "${searchTerm}"`}
                        {sortField && (
                          <span className="ml-2 text-gray-500">
                            • Sorted by {sortField.replace('_', ' ')} ({sortDirection === 'asc' ? 'ascending' : 'descending'})
                          </span>
                        )}
                      </p>
                      <button
                        onClick={() => {
                          const csv = [
                            ['Customer #', 'Name', 'Email', 'Phone', 'Balance', 'Status'].join(','),
                            ...filteredAndSortedCustomers.map(c => [
                              c.customer_number,
                              c.display_name || '',
                              c.email || '',
                              c.phone || '',
                              c.current_balance || 0,
                              c.is_active ? 'Active' : 'Inactive'
                            ].join(','))
                          ].join('\n')
                          const blob = new Blob([csv], { type: 'text/csv' })
                          const url = window.URL.createObjectURL(blob)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = `customers-${new Date().toISOString().split('T')[0]}.csv`
                          a.click()
                          window.URL.revokeObjectURL(url)
                          toast.success('Customers exported successfully!')
                        }}
                        className="flex items-center space-x-2 px-4 py-2 text-sm text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        <Download className="h-4 w-4" />
                        <span>Export CSV</span>
                      </button>
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
                    <h2 className="text-xl font-bold text-gray-900">Delete Customer</h2>
                    <button
                      onClick={() => setShowDeleteConfirm(null)}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <p className="text-gray-600 mb-6">
                    Are you sure you want to delete this customer? This action cannot be undone and will mark the customer as inactive.
                  </p>
                  <div className="flex justify-end space-x-3">
                    <button
                      onClick={() => setShowDeleteConfirm(null)}
                      className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleDelete(showDeleteConfirm)}
                      className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Create/Edit Modal */}
            {showModal && (
              <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
                <div className="bg-white rounded-lg p-8 max-w-3xl w-full max-h-[90vh] overflow-y-auto shadow-xl my-8">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-2xl font-bold text-gray-900">
                      {editingCustomer ? 'Edit Customer' : 'Add New Customer'}
                    </h2>
                    <button
                      onClick={handleCloseModal}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <X className="h-6 w-6" />
                    </button>
                  </div>
                  <form onSubmit={editingCustomer ? handleUpdate : handleCreate}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Company Name
                        </label>
                        <input
                          type="text"
                          value={formData.company_name}
                          onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Enter company name"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Contact Person
                        </label>
                        <input
                          type="text"
                          value={formData.contact_person}
                          onChange={(e) => setFormData({ ...formData, contact_person: e.target.value })}
                          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="Enter contact person name"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                        <input
                          type="email"
                          value={formData.email}
                          onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="customer@example.com"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                        <input
                          type="text"
                          value={formData.phone}
                          onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="+1 234 567 8900"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <p className="text-sm font-semibold text-gray-800 mb-3">Bank details (optional)</p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Account number
                            </label>
                            <input
                              type="text"
                              value={formData.bank_account_number}
                              onChange={(e) =>
                                setFormData({ ...formData, bank_account_number: e.target.value })
                              }
                              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              autoComplete="off"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Bank name
                            </label>
                            <input
                              type="text"
                              value={formData.bank_name}
                              onChange={(e) =>
                                setFormData({ ...formData, bank_name: e.target.value })
                              }
                              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Branch
                            </label>
                            <input
                              type="text"
                              value={formData.bank_branch}
                              onChange={(e) =>
                                setFormData({ ...formData, bank_branch: e.target.value })
                              }
                              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                              Routing number
                            </label>
                            <input
                              type="text"
                              value={formData.bank_routing_number}
                              onChange={(e) =>
                                setFormData({ ...formData, bank_routing_number: e.target.value })
                              }
                              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                              placeholder="ABA / sort code / SWIFT as needed"
                            />
                          </div>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Opening Balance ({currencySymbol})
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          value={formData.opening_balance}
                          onChange={(e) => setFormData({ ...formData, opening_balance: parseFloat(e.target.value) || 0 })}
                          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          placeholder="0.00"
                        />
                        <p className="mt-1.5 text-xs text-gray-500">
                          {editingCustomer ? 'Update opening balance if needed' : 'Starting balance owed by this customer'}
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          As of Date
                        </label>
                        <input
                          type="date"
                          value={formData.opening_balance_date}
                          onChange={(e) => setFormData({ ...formData, opening_balance_date: e.target.value })}
                          className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                        />
                        <p className="mt-1.5 text-xs text-gray-500">
                          Date of the opening balance
                        </p>
                      </div>
                      <div className="md:col-span-2">
                        <label className="flex items-center space-x-3">
                          <input
                            type="checkbox"
                            checked={formData.is_active}
                            onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                            className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                          />
                          <span className="text-sm font-medium text-gray-700">Active Customer</span>
                        </label>
                      </div>
                    </div>
                    <div className="flex justify-end space-x-3 pt-6 border-t border-gray-200">
                      <button
                        type="button"
                        onClick={handleCloseModal}
                        className="px-6 py-2.5 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors font-medium"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-sm"
                      >
                        {editingCustomer ? 'Update Customer' : 'Create Customer'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </CompanyProvider>
  )
}
