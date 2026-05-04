'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { Plus, Edit, Trash2, Search, AlertTriangle, RefreshCw, BookOpen, Building2, MapPin } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api, { getBackendOrigin } from '@/lib/api'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { extractErrorMessage } from '@/utils/errorHandler'
import { isConnectionError } from '@/utils/connectionError'
import { ReferenceCodePicker } from '@/components/ReferenceCodePicker'

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
}

interface StationOption {
  id: number
  station_name: string
  is_active?: boolean
}

interface PondOption {
  id: number
  name: string
  code?: string
  is_active?: boolean
}

export default function VendorsPage() {
  const router = useRouter()
  const toast = useToast()
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null)
  const [currencySymbol, setCurrencySymbol] = useState<string>('৳') // Default to BDT
  const [vendorRefCode, setVendorRefCode] = useState('')
  const [createCodeNonce, setCreateCodeNonce] = useState(0)
  const [stations, setStations] = useState<StationOption[]>([])
  const [ponds, setPonds] = useState<PondOption[]>([])
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
  })

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    fetchStationsList()
    fetchPondsList()
    fetchVendors()
  }, [router])

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

  const fetchVendors = async () => {
    setLoading(true)
    setError(null)
    try {
      // Fetch company currency
      try {
        const companyRes = await api.get('/companies/current')
        if (companyRes.data?.currency) {
          setCurrencySymbol(getCurrencySymbol(companyRes.data.currency))
        }
      } catch (error) {
        // Silently handle connection errors - backend may not be running
        if (!isConnectionError(error)) {
          console.error('Error fetching company currency:', error)
        }
      }

      const response = await api.get('/vendors/')
      if (response.status === 200) {
        setVendors(response.data)
        setError(null)
      } else if (response.status === 401 || response.status === 403) {
        localStorage.removeItem('access_token')
        router.push('/login')
        return
      } else {
        const errorMsg = `Failed to load vendors: ${response.status}`
        setError(errorMsg)
        toast.error(errorMsg)
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
    } finally {
      setLoading(false)
    }
  }

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
        ...(vendorRefCode.trim() ? { vendor_number: vendorRefCode.trim() } : {}),
      })
      toast.success('Vendor created successfully!')
      setShowModal(false)
      fetchVendors()
      resetForm()
    } catch (error) {
      console.error('Error creating vendor:', error)
      const errorMessage = extractErrorMessage(error, 'Failed to create vendor')
      toast.error(errorMessage)
    }
  }

  const handleEdit = (vendor: Vendor) => {
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
      })
      toast.success('Vendor updated successfully!')
      setShowModal(false)
      setEditingVendor(null)
      fetchVendors()
      resetForm()
    } catch (error) {
      console.error('Error updating vendor:', error)
      const errorMessage = extractErrorMessage(error, 'Failed to update vendor')
      toast.error(errorMessage)
    }
  }

  const handleDelete = async (vendorId: number) => {
    try {
      await api.delete(`/vendors/${vendorId}/`)
      toast.success('Vendor deleted successfully!')
      setShowDeleteConfirm(null)
      fetchVendors()
    } catch (error) {
      console.error('Error deleting vendor:', error)
      const errorMessage = extractErrorMessage(error, 'Failed to delete vendor')
      toast.error(errorMessage)
    }
  }

  const resetForm = () => {
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
    })
    setVendorRefCode('')
    setEditingVendor(null)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    resetForm()
  }

  const filteredVendors = vendors.filter((vendor) => {
    const q = searchTerm.toLowerCase()
    if (!q) return true
    return (
      vendor.display_name.toLowerCase().includes(q) ||
      vendor.company_name.toLowerCase().includes(q) ||
      vendor.vendor_number.toLowerCase().includes(q) ||
      (vendor.email || '').toLowerCase().includes(q) ||
      (vendor.default_station_name || '').toLowerCase().includes(q) ||
      (vendor.default_aquaculture_pond_name || '').toLowerCase().includes(q)
    )
  })

  const defaultReceivingLabel = (vendor: Vendor) => {
    const pond = (vendor.default_aquaculture_pond_name || '').trim()
    if (pond) return pond
    const site = (vendor.default_station_name || '').trim()
    if (site) return site
    return '—'
  }

  return (
    <CompanyProvider>
      <div className="flex h-screen bg-gray-100 page-with-sidebar">
        <Sidebar />
        <div className="flex-1 overflow-auto app-scroll-pad">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Vendors</h1>
          <p className="text-gray-600 mt-1">Manage your vendor accounts</p>
        </div>

        <div className="flex items-center justify-between mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
            <input
              type="text"
              placeholder="Search by name, #, email, default site or pond…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              resetForm()
              setCreateCodeNonce((n) => n + 1)
              setShowModal(true)
            }}
            className="ml-4 flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-5 w-5" />
            <span>Add Vendor</span>
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
            <AlertTriangle className="h-12 w-12 text-red-600 mx-auto mb-4" />
            <h3 className="text-xl font-bold text-red-800 mb-2">Error Loading Vendors</h3>
            <p className="text-red-700 mb-4">{error}</p>
            <button
              onClick={fetchVendors}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              <RefreshCw className="h-5 w-5" />
              <span>Retry</span>
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm overflow-hidden border border-gray-200">
            <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Vendor #
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Company
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Display Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hidden md:table-cell">
                    <span className="inline-flex items-center gap-1">
                      <Building2 className="h-3.5 w-3.5 text-amber-600/90" />
                      Site / pond
                    </span>
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Balance
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredVendors.map((vendor) => (
                  <tr key={vendor.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {vendor.vendor_number}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {vendor.company_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {vendor.display_name}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700 max-w-[14rem] hidden md:table-cell">
                      <span className="inline-flex items-center gap-1.5">
                        {(vendor.default_aquaculture_pond_name || '').trim() ? (
                          <MapPin className="h-3.5 w-3.5 text-teal-600/85 shrink-0" />
                        ) : (
                          <Building2 className="h-3.5 w-3.5 text-amber-600/80 shrink-0" />
                        )}
                        <span className="truncate" title={defaultReceivingLabel(vendor)}>
                          {defaultReceivingLabel(vendor)}
                        </span>
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                      {vendor.email}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {currencySymbol}{formatNumber(Number(vendor.current_balance || 0))}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        vendor.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {vendor.is_active ? 'Active' : 'Inactive'}
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
                          className="inline-flex touch-min items-center justify-center rounded-md text-blue-600 hover:bg-blue-50 hover:text-blue-800 transition-colors"
                          title="Edit vendor"
                        >
                          <Edit className="h-4 w-4 shrink-0" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowDeleteConfirm(vendor.id)}
                          className="inline-flex touch-min items-center justify-center rounded-md text-red-600 hover:bg-red-50 hover:text-red-800 transition-colors"
                          title="Delete vendor"
                        >
                          <Trash2 className="h-4 w-4 shrink-0" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <h2 className="text-xl font-bold mb-4">Delete Vendor</h2>
              <p className="text-gray-600 mb-6">
                Are you sure you want to delete this vendor? This action cannot be undone.
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

        {/* Create/Edit Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg app-modal-pad max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-2xl font-bold mb-6">
                {editingVendor ? 'Edit Vendor' : 'Add New Vendor'}
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
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Company Name
                    </label>
                    <input
                      type="text"
                      value={formData.company_name}
                      onChange={(e) => setFormData({ ...formData, company_name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
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
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Phone</label>
                    <input
                      type="text"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2 inline-flex items-center gap-1.5">
                      <Building2 className="h-4 w-4 text-amber-600" />
                      Default site / pond
                    </label>
                    <select
                      value={formData.default_receiving}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          default_receiving: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="">— Not set —</option>
                      <optgroup label="Sites (shop / warehouse)">
                        {stations.map((s) => (
                          <option key={`s-${s.id}`} value={`s:${s.id}`}>
                            {s.station_name}
                          </option>
                        ))}
                      </optgroup>
                      {ponds.length > 0 ? (
                        <optgroup label="Ponds (fish & fry — delivered to pond)">
                          {ponds.map((p) => (
                            <option key={`p-${p.id}`} value={`p:${p.id}`}>
                              {p.name}
                              {p.code ? ` (${p.code})` : ''}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </select>
                    <p className="mt-1 text-xs text-gray-500">
                      Shop sites for general receipts; ponds for fish and fry delivered to the pond. On{' '}
                      <Link href="/stations" className="text-blue-600 hover:underline">
                        Stations
                      </Link>
                      , set the shop's default pond so new bills still receive into the right stock.
                    </p>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">Address</label>
                    <input
                      type="text"
                      value={formData.billing_address_line1}
                      onChange={(e) => setFormData({ ...formData, billing_address_line1: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <p className="text-sm font-semibold text-gray-800 mb-2">Bank details (optional)</p>
                    <div className="grid grid-cols-2 gap-4">
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
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
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
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
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
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
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
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
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
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="0.00"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      {editingVendor ? 'Update opening balance if needed' : 'Starting balance you owe this vendor'}
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
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="mt-1 text-xs text-gray-500">
                      Date of the opening balance
                    </p>
                  </div>
                  <div className="col-span-2">
                    <label className="flex items-center space-x-2">
                      <input
                        type="checkbox"
                        checked={formData.is_active}
                        onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                        className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-gray-700">Active</span>
                    </label>
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
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    {editingVendor ? 'Update Vendor' : 'Create Vendor'}
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
