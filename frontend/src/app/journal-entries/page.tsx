'use client'

import { useEffect, useState, Fragment } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { Plus, Edit2, Trash2, X, Eye, CheckCircle, XCircle, AlertCircle, Search, Filter, AlertTriangle, RefreshCw } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api, { getBackendOrigin } from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { formatCoaOptionLabel } from '@/utils/coaOptionLabel'
import { formatDateOnly } from '@/utils/date'
import { AMOUNT_JE_LINE_CLASS } from '@/utils/amountFieldStyles'

interface JournalEntryLine {
  id?: number
  line_number: number
  description?: string
  debit_account_id?: number | null
  credit_account_id?: number | null
  amount: number
  debit_account_name?: string
  credit_account_name?: string
  debit_account_code?: string
  credit_account_code?: string
}

interface JournalEntry {
  id: number
  entry_number: string
  entry_date: string
  reference?: string
  description?: string
  total_debit: number | string
  total_credit: number | string
  is_posted: boolean
  created_by?: number
  created_at: string
  updated_at: string
  lines: JournalEntryLine[]
}

interface Account {
  id: number
  account_code: string
  account_name: string
  account_type: string
  account_sub_type?: string
  is_active?: boolean
}

export default function JournalEntriesPage() {
  const router = useRouter()
  const toast = useToast()
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [allEntries, setAllEntries] = useState<JournalEntry[]>([]) // Store all entries for client-side filtering
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [showViewModal, setShowViewModal] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null)
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null)
  const [viewingEntry, setViewingEntry] = useState<JournalEntry | null>(null)
  const [currencySymbol, setCurrencySymbol] = useState<string>('৳') // Default to BDT
  
  // Filter states
  const [filterColumn, setFilterColumn] = useState<string>('all')
  const [filterValue, setFilterValue] = useState<string>('')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [showFilters, setShowFilters] = useState(false)
  const [formData, setFormData] = useState({
    entry_date: new Date().toISOString().split('T')[0],
    reference: '',
    description: '',
    lines: [
      { line_number: 1, description: '', debit_account_id: null, credit_account_id: null, amount: 0 },
      { line_number: 2, description: '', debit_account_id: null, credit_account_id: null, amount: 0 }
    ] as Omit<JournalEntryLine, 'id' | 'debit_account_name' | 'credit_account_name' | 'debit_account_code' | 'credit_account_code'>[]
  })

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    fetchData()
  }, [router])

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const token = localStorage.getItem('access_token')
      if (!token) {
        router.push('/login')
        return
      }
      
      // Fetch company currency
      try {
        const companyRes = await api.get('/companies/current')
        if (companyRes.data?.currency) {
          setCurrencySymbol(getCurrencySymbol(companyRes.data.currency))
        }
      } catch (error) {
        console.error('Error fetching company currency:', error)
      }
      
      // Build query parameters
      const params = new URLSearchParams()
      if (filterColumn && filterColumn !== 'all' && filterValue) {
        params.append('filter_column', filterColumn)
        params.append('filter_value', filterValue)
      }
      if (startDate) {
        params.append('start_date', startDate)
      }
      if (endDate) {
        params.append('end_date', endDate)
      }
      params.append('limit', '1000') // Get more entries for client-side filtering
      
      const queryString = params.toString()
      const url = `/journal-entries${queryString ? `?${queryString}` : ''}`

      const [entriesRes, accountsRes] = await Promise.allSettled([
        api.get(url),
        api.get('/chart-of-accounts/')
      ])

      if (entriesRes.status === 'fulfilled') {
        const entriesData = entriesRes.value.data
        setAllEntries(entriesData)
        setError(null)
        // Filters will be applied automatically via useEffect
      } else {
        console.error('Failed to load journal entries:', entriesRes.reason)
        const errorMsg = 'Failed to load journal entries'
        setError(errorMsg)
        toast.error(errorMsg)
      }

      if (accountsRes.status === 'fulfilled') {
        const accountsData = accountsRes.value.data
        setAccounts(accountsData.filter((acc: Account) => acc.is_active))
      } else {
        console.error('Failed to load chart of accounts:', accountsRes.reason)
      }
    } catch (error: any) {
      console.error('Error fetching data:', error)
      if (error.response?.status === 401 || error.response?.status === 403) {
        localStorage.removeItem('access_token')
        router.push('/login')
        return
      }
      let userMessage = 'Error connecting to server'
      if (error.message?.includes('fetch') || error.message?.includes('Failed to fetch')) {
        userMessage = `Cannot connect to backend server. Please ensure the backend is running on ${getBackendOrigin()}`
      } else {
        userMessage = error.response?.data?.detail || error.message || 'Unknown error'
      }
      setError(userMessage)
      toast.error(userMessage)
    } finally {
      setLoading(false)
    }
  }
  
  const applyClientSideFilters = (entriesList: JournalEntry[]) => {
    let filtered = [...entriesList]
    
    // Apply client-side filtering if filter_column is set
    if (filterColumn && filterColumn !== 'all' && filterValue) {
      const searchValue = filterValue.toLowerCase().trim()
      
      switch (filterColumn) {
        case 'entry_number':
          filtered = filtered.filter(entry => 
            entry.entry_number.toLowerCase().includes(searchValue)
          )
          break
        case 'reference':
          filtered = filtered.filter(entry => 
            entry.reference?.toLowerCase().includes(searchValue)
          )
          break
        case 'description':
          filtered = filtered.filter(entry => 
            entry.description?.toLowerCase().includes(searchValue)
          )
          break
        case 'account':
          filtered = filtered.filter(entry => 
            entry.lines.some(line => 
              line.debit_account_name?.toLowerCase().includes(searchValue) ||
              line.debit_account_code?.toLowerCase().includes(searchValue) ||
              line.credit_account_name?.toLowerCase().includes(searchValue) ||
              line.credit_account_code?.toLowerCase().includes(searchValue)
            )
          )
          break
        case 'amount':
          try {
            // Try exact amount first
            const amountValue = parseFloat(searchValue)
            if (!isNaN(amountValue)) {
              filtered = filtered.filter(entry => 
                Math.abs(Number(entry.total_debit) - amountValue) < 0.01 ||
                Math.abs(Number(entry.total_credit) - amountValue) < 0.01
              )
            } else if (searchValue.includes('-')) {
              // Try range (e.g., "100-500")
              const parts = searchValue.split('-')
              const minAmount = parseFloat(parts[0].trim())
              const maxAmount = parseFloat(parts[1].trim())
              if (!isNaN(minAmount) && !isNaN(maxAmount)) {
                filtered = filtered.filter(entry => 
                  (Number(entry.total_debit) >= minAmount && Number(entry.total_debit) <= maxAmount) ||
                  (Number(entry.total_credit) >= minAmount && Number(entry.total_credit) <= maxAmount)
                )
              }
            }
          } catch (e) {
            // Invalid amount, skip filtering
          }
          break
        case 'is_posted':
          if (searchValue === 'true' || searchValue === '1' || searchValue === 'yes' || searchValue === 'posted') {
            filtered = filtered.filter(entry => entry.is_posted === true)
          } else if (searchValue === 'false' || searchValue === '0' || searchValue === 'no' || searchValue === 'draft') {
            filtered = filtered.filter(entry => entry.is_posted === false)
          }
          break
      }
    }
    
    // Apply date range filter
    if (startDate || endDate) {
      filtered = filtered.filter(entry => {
        const entryDate = new Date(entry.entry_date.split('T')[0]) // Extract date part only
        if (startDate) {
          const start = new Date(startDate)
          start.setHours(0, 0, 0, 0)
          if (entryDate < start) {
            return false
          }
        }
        if (endDate) {
          const end = new Date(endDate)
          end.setHours(23, 59, 59, 999)
          if (entryDate > end) {
            return false
          }
        }
        return true
      })
    }
    
    setEntries(filtered)
  }
  
  // Apply filters when filter values or allEntries change
  useEffect(() => {
    if (allEntries.length >= 0) { // Always apply filters (even for empty array)
      applyClientSideFilters(allEntries)
    }
  }, [filterColumn, filterValue, startDate, endDate, allEntries])

  const calculateTotals = () => {
    const totalDebit = formData.lines
      .filter(line => line.debit_account_id)
      .reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
    
    const totalCredit = formData.lines
      .filter(line => line.credit_account_id)
      .reduce((sum, line) => sum + (Number(line.amount) || 0), 0)
    
    return { totalDebit, totalCredit }
  }

  const isBalanced = () => {
    const { totalDebit, totalCredit } = calculateTotals()
    return Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0
  }

  const addLine = () => {
    setFormData({
      ...formData,
      lines: [
        ...formData.lines,
        {
          line_number: formData.lines.length + 1,
          description: '',
          debit_account_id: null,
          credit_account_id: null,
          amount: 0
        }
      ]
    })
  }

  const removeLine = (index: number) => {
    if (formData.lines.length <= 2) {
      toast.error('Journal entry must have at least 2 lines')
      return
    }
    const newLines = formData.lines.filter((_, i) => i !== index).map((line, i) => ({
      ...line,
      line_number: i + 1
    }))
    setFormData({ ...formData, lines: newLines })
  }

  const updateLine = (index: number, field: string, value: any) => {
    const newLines = [...formData.lines]
    if (field === 'debit_account_id') {
      newLines[index] = { ...newLines[index], debit_account_id: value ? parseInt(value) : null, credit_account_id: null }
    } else if (field === 'credit_account_id') {
      newLines[index] = { ...newLines[index], credit_account_id: value ? parseInt(value) : null, debit_account_id: null }
    } else {
      newLines[index] = { ...newLines[index], [field]: value }
    }
    setFormData({ ...formData, lines: newLines })
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!isBalanced()) {
      toast.error('Journal entry must be balanced (Total Debit = Total Credit)')
      return
    }

    const linesToSubmit = formData.lines.filter(line => 
      (line.debit_account_id || line.credit_account_id) && Number(line.amount) > 0
    )

    if (linesToSubmit.length < 2) {
      toast.error('Journal entry must have at least 2 lines')
      return
    }

    try {
      await api.post('/journal-entries/', {
        entry_date: formData.entry_date,
        reference: formData.reference || null,
        description: formData.description || null,
        lines: linesToSubmit.map((line) => ({
          line_number: line.line_number,
          description: line.description || null,
          debit_account_id: line.debit_account_id || null,
          credit_account_id: line.credit_account_id || null,
          amount: Number(line.amount),
        })),
      })
      toast.success('Journal entry created successfully!')
      setShowModal(false)
      resetForm()
      fetchData()
    } catch (error) {
      console.error('Error creating journal entry:', error)
      toast.error(extractErrorMessage(error, 'Failed to create journal entry'))
    }
  }

  const handleEdit = (entry: JournalEntry) => {
    if (entry.is_posted) {
      toast.error('Cannot edit posted journal entry')
      return
    }
    setEditingEntry(entry)
    setFormData({
      entry_date: entry.entry_date.split('T')[0],
      reference: entry.reference || '',
      description: entry.description || '',
      lines: entry.lines.map(line => ({
        line_number: line.line_number,
        description: line.description || '',
        debit_account_id: line.debit_account_id || null,
        credit_account_id: line.credit_account_id || null,
        amount: Number(line.amount)
      }))
    })
    setShowModal(true)
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingEntry) return

    if (!isBalanced()) {
      toast.error('Journal entry must be balanced (Total Debit = Total Credit)')
      return
    }

    const linesToSubmit = formData.lines.filter(line => 
      (line.debit_account_id || line.credit_account_id) && Number(line.amount) > 0
    )

    if (linesToSubmit.length < 2) {
      toast.error('Journal entry must have at least 2 lines')
      return
    }

    try {
      await api.put(`/journal-entries/${editingEntry.id}/`, {
        entry_date: formData.entry_date,
        reference: formData.reference || null,
        description: formData.description || null,
        lines: linesToSubmit.map((line) => ({
          line_number: line.line_number,
          description: line.description || null,
          debit_account_id: line.debit_account_id || null,
          credit_account_id: line.credit_account_id || null,
          amount: Number(line.amount),
        })),
      })
      toast.success('Journal entry updated successfully!')
      setShowModal(false)
      setEditingEntry(null)
      resetForm()
      await fetchData()
    } catch (error) {
      console.error('Error updating journal entry:', error)
      toast.error(extractErrorMessage(error, 'Failed to update journal entry'))
    }
  }

  const handlePost = async (entryId: number) => {
    try {
      await api.post(`/journal-entries/${entryId}/post/`)
      toast.success('Journal entry posted successfully!')
      await fetchData()
    } catch (error) {
      console.error('Error posting journal entry:', error)
      toast.error(extractErrorMessage(error, 'Failed to post journal entry'))
    }
  }

  const handleUnpost = async (entryId: number) => {
    try {
      await api.post(`/journal-entries/${entryId}/unpost/`, {})
      toast.success('Journal entry unposted successfully!')
      await fetchData()
    } catch (error) {
      console.error('Error unposting journal entry:', error)
      toast.error(extractErrorMessage(error, 'Failed to unpost journal entry'))
    }
  }

  const handleDelete = async (entryId: number) => {
    try {
      await api.delete(`/journal-entries/${entryId}/`)
      toast.success('Journal entry deleted successfully!')
      setShowDeleteConfirm(null)
      await fetchData()
    } catch (error) {
      console.error('Error deleting journal entry:', error)
      toast.error(extractErrorMessage(error, 'Failed to delete journal entry'))
    }
  }

  const handleView = async (entryId: number) => {
    try {
      const response = await api.get(`/journal-entries/${entryId}/`)
      setViewingEntry(response.data)
      setShowViewModal(true)
    } catch (error) {
      console.error('Error loading journal entry:', error)
      toast.error(extractErrorMessage(error, 'Failed to load journal entry'))
    }
  }

  const resetForm = () => {
    setFormData({
      entry_date: new Date().toISOString().split('T')[0],
      reference: '',
      description: '',
      lines: [
        { line_number: 1, description: '', debit_account_id: null, credit_account_id: null, amount: 0 },
        { line_number: 2, description: '', debit_account_id: null, credit_account_id: null, amount: 0 }
      ]
    })
    setEditingEntry(null)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    resetForm()
  }

  const { totalDebit, totalCredit } = calculateTotals()
  const balanceDifference = Math.abs(totalDebit - totalCredit)

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto">
        <div className="app-scroll-pad">
          {error ? (
            <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
              <AlertTriangle className="h-12 w-12 text-red-600 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-red-800 mb-2">Error Loading Journal Entries</h3>
              <p className="text-red-700 mb-4">{error}</p>
              <button
                onClick={fetchData}
                className="inline-flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                <RefreshCw className="h-5 w-5" />
                <span>Retry</span>
              </button>
            </div>
          ) : (
            <Fragment>
              <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Journal Entries</h1>
                <p className="text-gray-600 mt-1">Manual accounting entries</p>
              </div>
            <div className="flex items-center space-x-3">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center space-x-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                <Filter className="h-5 w-5" />
                <span>Filter</span>
              </button>
              <button
                onClick={() => {
                  resetForm()
                  setShowModal(true)
                }}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus className="h-5 w-5" />
                <span>New Journal Entry</span>
              </button>
            </div>
          </div>

          {/* Filter Panel */}
          {showFilters && (
            <div className="bg-white rounded-lg shadow-md p-6 mb-6 border border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Filter Transactions</h2>
                <button
                  onClick={() => {
                    setFilterColumn('all')
                    setFilterValue('')
                    setStartDate('')
                    setEndDate('')
                    setShowFilters(false)
                  }}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Clear All
                </button>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Date Range */}
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Report Period: Date Range
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="From Date"
                    />
                    <span className="text-gray-500">to</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="To Date"
                    />
                  </div>
                </div>

                {/* Filter Column Dropdown */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Filter By Column
                  </label>
                  <select
                    value={filterColumn}
                    onChange={(e) => {
                      setFilterColumn(e.target.value)
                      setFilterValue('')
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="all">All Columns</option>
                    <option value="entry_number">Entry Number</option>
                    <option value="reference">Reference</option>
                    <option value="description">Description</option>
                    <option value="account">Account (Name/Code)</option>
                    <option value="amount">Amount</option>
                    <option value="is_posted">Status (Posted/Draft)</option>
                  </select>
                </div>

                {/* Filter Value Input */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {filterColumn === 'all' ? 'Search Value' : `Search ${filterColumn.replace('_', ' ')}`}
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={filterValue}
                      onChange={(e) => setFilterValue(e.target.value)}
                      placeholder={filterColumn === 'amount' ? 'e.g., 1000 or 100-500' : filterColumn === 'is_posted' ? 'true/false or posted/draft' : 'Enter search value'}
                      className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      disabled={filterColumn === 'all'}
                    />
                    <Search className="absolute right-3 top-2.5 h-5 w-5 text-gray-400" />
                  </div>
                  {filterColumn === 'amount' && (
                    <p className="text-xs text-gray-500 mt-1">Enter amount or range (e.g., 100-500)</p>
                  )}
                  {filterColumn === 'is_posted' && (
                    <p className="text-xs text-gray-500 mt-1">Enter: true/false, posted/draft, yes/no</p>
                  )}
                </div>
              </div>
              
              {/* Active Filters Display */}
              {(filterColumn !== 'all' || startDate || endDate) && (
                <div className="mt-4 pt-4 border-t border-gray-200">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-gray-600">Active Filters:</span>
                    {startDate && (
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                        From: {formatDateOnly(startDate)}
                        <button
                          onClick={() => setStartDate('')}
                          className="ml-1 hover:text-blue-600"
                        >
                          ×
                        </button>
                      </span>
                    )}
                    {endDate && (
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs">
                        To: {formatDateOnly(endDate)}
                        <button
                          onClick={() => setEndDate('')}
                          className="ml-1 hover:text-blue-600"
                        >
                          ×
                        </button>
                      </span>
                    )}
                    {filterColumn !== 'all' && filterValue && (
                      <span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs">
                        {filterColumn.replace('_', ' ')}: {filterValue}
                        <button
                          onClick={() => {
                            setFilterColumn('all')
                            setFilterValue('')
                          }}
                          className="ml-1 hover:text-green-600"
                        >
                          ×
                        </button>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    Showing {entries.length} of {allEntries.length} entries
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entry #</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Debit</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Credit</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {entries.map((entry) => (
                  <tr key={entry.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {entry.entry_number}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {formatDateOnly(entry.entry_date)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {entry.reference || '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {entry.description || '-'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-900">
                      {currencySymbol}{formatNumber(Number(entry.total_debit || 0))}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-gray-900">
                      {currencySymbol}{formatNumber(Number(entry.total_credit || 0))}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs rounded-full ${
                        entry.is_posted 
                          ? 'bg-green-100 text-green-800' 
                          : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {entry.is_posted ? 'Posted' : 'Draft'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => handleView(entry.id)}
                          className="text-blue-600 hover:text-blue-900"
                          title="View"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        {!entry.is_posted && (
                          <>
                            <button
                              onClick={() => handleEdit(entry)}
                              className="text-blue-600 hover:text-blue-900"
                              title="Edit"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setShowDeleteConfirm(entry.id)}
                              className="text-red-600 hover:text-red-900"
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {entry.is_posted ? (
                          <button
                            onClick={() => handleUnpost(entry.id)}
                            className="text-orange-600 hover:text-orange-900"
                            title="Unpost"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handlePost(entry.id)}
                            className="text-green-600 hover:text-green-900"
                            title="Post"
                          >
                            <CheckCircle className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {entries.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                No journal entries found. Create your first entry to get started.
              </div>
            )}
          </div>

          {/* Delete Confirmation Modal */}
          {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h2 className="text-xl font-bold mb-4">Delete Journal Entry</h2>
            <p className="text-gray-600 mb-6">
              Are you sure you want to delete this journal entry? This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(showDeleteConfirm)}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* View Modal */}
      {showViewModal && viewingEntry && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white rounded-lg app-modal-pad max-w-4xl w-full max-h-[90vh] overflow-y-auto my-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">Journal Entry: {viewingEntry.entry_number}</h2>
              <button
                onClick={() => {
                  setShowViewModal(false)
                  setViewingEntry(null)
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <p className="text-gray-900">{formatDateOnly(viewingEntry.entry_date)}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reference</label>
                <p className="text-gray-900">{viewingEntry.reference || '-'}</p>
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <p className="text-gray-900">{viewingEntry.description || '-'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <span className={`px-2 py-1 text-xs rounded-full ${
                  viewingEntry.is_posted 
                    ? 'bg-green-100 text-green-800' 
                    : 'bg-yellow-100 text-yellow-800'
                }`}>
                  {viewingEntry.is_posted ? 'Posted' : 'Draft'}
                </span>
              </div>
            </div>

            <div className="border-t pt-4">
              <h3 className="text-lg font-semibold mb-4">Entry Lines</h3>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Line</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Debit</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Credit</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {viewingEntry.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="px-4 py-2 text-sm text-gray-900">{line.line_number}</td>
                      <td className="px-4 py-2 text-sm text-gray-900">
                        {line.debit_account_id 
                          ? `${line.debit_account_code} - ${line.debit_account_name}`
                          : line.credit_account_id
                          ? `${line.credit_account_code} - ${line.credit_account_name}`
                          : '-'
                        }
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-600">{line.description || '-'}</td>
                      <td className="px-4 py-2 text-sm text-right font-medium text-gray-900">
                        {line.debit_account_id ? `${currencySymbol}${formatNumber(Number(line.amount))}` : '-'}
                      </td>
                      <td className="px-4 py-2 text-sm text-right font-medium text-gray-900">
                        {line.credit_account_id ? `${currencySymbol}${formatNumber(Number(line.amount))}` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-gray-50">
                  <tr>
                    <td colSpan={3} className="px-4 py-2 text-sm font-semibold text-gray-900 text-right">Total:</td>
                    <td className="px-4 py-2 text-sm font-semibold text-gray-900 text-right">
                      {currencySymbol}{formatNumber(Number(viewingEntry.total_debit))}
                    </td>
                    <td className="px-4 py-2 text-sm font-semibold text-gray-900 text-right">
                      {currencySymbol}{formatNumber(Number(viewingEntry.total_credit))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
          )}

          {/* Create/Edit Modal */}
          {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
          <div className="bg-white rounded-lg app-modal-pad max-w-5xl w-full max-h-[90vh] overflow-y-auto my-8">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold">
                {editingEntry ? 'Edit Journal Entry' : 'New Journal Entry'}
              </h2>
              <button
                onClick={handleCloseModal}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <form onSubmit={editingEntry ? handleUpdate : handleCreate}>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Entry Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.entry_date}
                    onChange={(e) => setFormData({ ...formData, entry_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Reference
                  </label>
                  <input
                    type="text"
                    value={formData.reference}
                    onChange={(e) => setFormData({ ...formData, reference: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Optional reference"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Description
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Optional description"
                  />
                </div>
              </div>

              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold">Entry Lines</h3>
                  <button
                    type="button"
                    onClick={addLine}
                    className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                  >
                    Add Line
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Line</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Account</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                        <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase">Action</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {formData.lines.map((line, index) => (
                        <tr key={index}>
                          <td className="px-3 py-2 text-sm text-gray-900">{line.line_number}</td>
                          <td className="px-3 py-2">
                            <select
                              value={line.debit_account_id || line.credit_account_id || ''}
                              onChange={(e) => {
                                const value = e.target.value ? parseInt(e.target.value) : null
                                if (value) {
                                  // Determine if it's debit or credit based on which field is empty
                                  if (!line.debit_account_id && !line.credit_account_id) {
                                    // First time selecting - default to debit
                                    updateLine(index, 'debit_account_id', value)
                                  } else if (line.debit_account_id) {
                                    updateLine(index, 'debit_account_id', value)
                                  } else {
                                    updateLine(index, 'credit_account_id', value)
                                  }
                                } else {
                                  updateLine(index, 'debit_account_id', null)
                                  updateLine(index, 'credit_account_id', null)
                                }
                              }}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                              required
                            >
                              <option value="">Select Account</option>
                              {accounts.map((account) => (
                                <option key={account.id} value={account.id}>
                                  {formatCoaOptionLabel(account)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={line.debit_account_id ? 'debit' : line.credit_account_id ? 'credit' : ''}
                              onChange={(e) => {
                                const accountId = line.debit_account_id || line.credit_account_id
                                if (accountId) {
                                  if (e.target.value === 'debit') {
                                    updateLine(index, 'debit_account_id', accountId)
                                  } else {
                                    updateLine(index, 'credit_account_id', accountId)
                                  }
                                }
                              }}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                              required
                            >
                              <option value="">Select Type</option>
                              <option value="debit">Debit</option>
                              <option value="credit">Credit</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={line.description}
                              onChange={(e) => updateLine(index, 'description', e.target.value)}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                              placeholder="Optional"
                            />
                          </td>
                          <td className="px-3 py-2 min-w-[10rem]">
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={line.amount}
                              onChange={(e) => updateLine(index, 'amount', e.target.value)}
                              className={AMOUNT_JE_LINE_CLASS}
                              placeholder="0.00"
                              required
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            {formData.lines.length > 2 && (
                              <button
                                type="button"
                                onClick={() => removeLine(index)}
                                className="text-red-600 hover:text-red-900"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50">
                      <tr>
                        <td colSpan={4} className="px-3 py-2 text-sm font-semibold text-gray-900 text-right">
                          Total:
                        </td>
                        <td colSpan={2} className="px-3 py-2">
                          <div className="flex justify-between text-sm">
                            <span className="font-semibold">Debit: {currencySymbol}{formatNumber(totalDebit)}</span>
                            <span className="font-semibold">Credit: {currencySymbol}{formatNumber(totalCredit)}</span>
                          </div>
                          {balanceDifference > 0.01 && (
                            <div className="mt-1 text-xs text-red-600 flex items-center">
                              <AlertCircle className="h-3 w-3 mr-1" />
                              Difference: {currencySymbol}{formatNumber(balanceDifference)}
                            </div>
                          )}
                          {isBalanced() && (
                            <div className="mt-1 text-xs text-green-600 flex items-center">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Balanced
                            </div>
                          )}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!isBalanced()}
                  className={`px-4 py-2 rounded-lg ${
                    isBalanced()
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  {editingEntry ? 'Update Entry' : 'Create Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
          )}
        </Fragment>
          )}
        </div>
      </div>
    </div>
  )
}
