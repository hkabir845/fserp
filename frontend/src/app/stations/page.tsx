'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { Plus, Edit, Trash2, Search, Building2, AlertTriangle, RefreshCw, Phone, MapPin } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api, { getApiDocsUrl } from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'

interface Station {
  id: number
  station_number: string
  station_name: string
  address_line1: string
  city: string
  state: string
  is_active: boolean
  phone?: string
}

export default function StationsPage() {
  const router = useRouter()
  const toast = useToast()
  const apiDocsUrl = getApiDocsUrl()
  const [stations, setStations] = useState<Station[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [formData, setFormData] = useState({
    station_name: '',
    address: '',
    city: '',
    state: '',
    phone: '',
    is_active: true
  })

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    fetchStations()
  }, [router])

  const fetchStations = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.get<Station[]>('/stations/')
      setStations(response.data)
    } catch (err: unknown) {
      const errorMessage = extractErrorMessage(err, 'Failed to load stations')
      const status = err && typeof err === 'object' && 'response' in err
        ? (err as { response?: { status?: number } }).response?.status
        : undefined
      const isAuth = status === 401 || status === 403
      if (isAuth) {
        localStorage.removeItem('access_token')
        router.push('/login')
        return
      }
      const isConnection =
        errorMessage.includes('ERR_CONNECTION_REFUSED') ||
        errorMessage.includes('ERR_NETWORK') ||
        errorMessage.includes('Network Error') ||
        errorMessage.includes('timeout')
      const displayMessage = isConnection
        ? 'Backend server is not running. Please start it with backend\\run.bat or run: cd backend && python manage.py runserver 8000'
        : errorMessage
      setError(displayMessage)
      toast.error(displayMessage)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.post('/stations/', {
        station_name: formData.station_name,
        address_line1: formData.address,
        city: formData.city,
        state: formData.state,
        phone: formData.phone || null,
        postal_code: ''
      })
      toast.success('Station created successfully!')
      setShowModal(false)
      resetForm()
      fetchStations()
    } catch (err) {
      const errorMessage = extractErrorMessage(err, 'Failed to create station')
      toast.error(errorMessage)
    }
  }

  const handleEdit = (station: Station) => {
    setEditingId(station.id)
    setFormData({
      station_name: station.station_name,
      address: station.address_line1 || '',
      city: station.city || '',
      state: station.state || '',
      phone: station.phone || '',
      is_active: station.is_active
    })
    setShowModal(true)
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId) return
    try {
      await api.put(`/stations/${editingId}/`, {
        station_name: formData.station_name,
        address_line1: formData.address,
        city: formData.city,
        state: formData.state,
        phone: formData.phone || null,
        postal_code: '',
        is_active: formData.is_active
      })
      toast.success('Station updated successfully!')
      setShowModal(false)
      resetForm()
      fetchStations()
    } catch (err) {
      const errorMessage = extractErrorMessage(err, 'Failed to update station')
      toast.error(errorMessage)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      await api.delete(`/stations/${deleteId}/`)
      toast.success('Station deleted successfully!')
      setShowDeleteConfirm(false)
      setDeleteId(null)
      fetchStations()
    } catch (err) {
      const errorMessage = extractErrorMessage(err, 'Failed to delete station')
      toast.error(errorMessage)
    }
  }

  const resetForm = () => {
    setFormData({
      station_name: '',
      address: '',
      city: '',
      state: '',
      phone: '',
      is_active: true
    })
    setEditingId(null)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    resetForm()
  }

  const filteredStations = stations.filter(
    (station) =>
      station.station_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (station.station_number && station.station_number.toLowerCase().includes(searchTerm.toLowerCase()))
  )

  const formatAddress = (station: Station) => {
    const addr = station.address_line1?.trim()
    const city = station.city?.trim()
    const state = station.state?.trim()
    if (!addr && !city && !state) return '—'
    return [addr, [city, state].filter(Boolean).join(', ')].filter(Boolean).join(' · ') || '—'
  }

  return (
    <CompanyProvider>
      <div className="flex h-screen bg-gray-100 page-with-sidebar">
        <Sidebar />
        <div className="flex-1 overflow-auto p-8">
          <div className="mb-6">
            <h1 className="text-3xl font-bold text-gray-900">Stations</h1>
            <p className="text-gray-600 mt-1">Manage your filling station locations</p>
          </div>

          <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
            <div className="relative flex-1 min-w-0 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-5 w-5 pointer-events-none" />
              <input
                type="text"
                placeholder="Search stations..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white shadow-sm"
              />
            </div>
            <button
              onClick={() => {
                resetForm()
                setShowModal(true)
              }}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-sm shrink-0"
            >
              <Plus className="h-5 w-5" />
              <span>Add Station</span>
            </button>
          </div>

          {loading ? (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-4" />
                <div className="h-4 bg-gray-200 rounded w-1/2" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div
                    key={i}
                    className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 animate-pulse h-56"
                  >
                    <div className="h-12 bg-gray-200 rounded-lg w-2/3 mb-4" />
                    <div className="h-4 bg-gray-200 rounded w-full mb-2" />
                    <div className="h-4 bg-gray-200 rounded w-4/5" />
                  </div>
                ))}
              </div>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-8">
              <div className="text-center mb-6">
                <AlertTriangle className="h-16 w-16 text-red-600 mx-auto mb-4" />
                <h3 className="text-xl font-bold text-red-800 mb-2">Error Loading Stations</h3>
                <p className="text-red-700 whitespace-pre-line text-left max-w-2xl mx-auto mb-6">{error}</p>
              </div>
              {(error.includes('run.bat') || error.includes('ERR_CONNECTION') || error.includes('ERR_NETWORK')) && (
                <div className="bg-white border border-red-300 rounded-lg p-6 mb-6 text-left max-w-3xl mx-auto">
                  <p className="text-sm font-semibold text-red-800 mb-2">To start the backend:</p>
                  <div className="bg-gray-100 p-3 rounded font-mono text-xs text-gray-800">
                    cd backend<br />
                    python manage.py runserver 8000
                  </div>
                  <p className="text-xs text-gray-600 mt-2">Or run <code className="bg-gray-200 px-1 rounded">backend\run.bat</code></p>
                  <p className="text-xs text-blue-700 mt-3">
                    Verify at <a href={apiDocsUrl} target="_blank" rel="noopener noreferrer" className="underline">{apiDocsUrl}</a> (DEBUG)
                  </p>
                </div>
              )}
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  onClick={fetchStations}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
                >
                  <RefreshCw className="h-5 w-5" />
                  <span>Retry</span>
                </button>
                <a
                  href={apiDocsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-6 py-3 border border-red-300 text-red-700 rounded-lg hover:bg-red-100 transition-colors font-medium"
                >
                  Check Backend
                </a>
              </div>
            </div>
          ) : filteredStations.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
              <div className="p-4 bg-gray-100 rounded-full w-fit mx-auto mb-4">
                <Building2 className="h-16 w-16 text-gray-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No stations found</h3>
              <p className="text-gray-600 mb-6 max-w-sm mx-auto">
                {stations.length === 0
                  ? 'Get started by adding your first filling station location.'
                  : 'No stations match your search. Try a different term.'}
              </p>
              {stations.length === 0 && (
                <button
                  onClick={() => setShowModal(true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
                >
                  <Plus className="h-5 w-5" />
                  <span>Add Station</span>
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredStations.map((station) => (
                <div
                  key={station.id}
                  className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow p-6 flex flex-col"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-3 bg-blue-100 rounded-lg shrink-0">
                        <Building2 className="h-6 w-6 text-blue-600" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-bold text-lg text-gray-900 truncate" title={station.station_name}>
                          {station.station_name}
                        </h3>
                        <p className="text-sm text-gray-500">
                          {station.station_number || `#${station.id}`}
                        </p>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold ${
                        station.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {station.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  <div className="space-y-2 mb-4 flex-1">
                    <div className="flex gap-2 text-sm text-gray-600">
                      <MapPin className="h-4 w-4 shrink-0 text-gray-400 mt-0.5" />
                      <span className="line-clamp-2">{formatAddress(station)}</span>
                    </div>
                    {station.phone && (
                      <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Phone className="h-4 w-4 shrink-0 text-gray-400" />
                        <span>{station.phone}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => router.push(`/tanks?station=${station.id}`)}
                      className="text-sm text-blue-600 hover:text-blue-800 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded"
                    >
                      View Tanks →
                    </button>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleEdit(station)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                        title="Edit Station"
                      >
                        <Edit className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDeleteId(station.id)
                          setShowDeleteConfirm(true)
                        }}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1"
                        title="Delete Station"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Create/Edit Modal */}
          {showModal && (
            <div
              className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
              onClick={(e) => e.target === e.currentTarget && handleCloseModal()}
            >
              <div
                className="bg-white rounded-xl shadow-xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 className="text-2xl font-bold text-gray-900 mb-6">
                  {editingId ? 'Edit Station' : 'Add New Station'}
                </h2>
                <form onSubmit={editingId ? handleUpdate : handleCreate} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Station Name *</label>
                    <input
                      type="text"
                      required
                      value={formData.station_name}
                      onChange={(e) => setFormData((prev) => ({ ...prev, station_name: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="e.g., Downtown Station"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Address *</label>
                    <input
                      type="text"
                      required
                      value={formData.address}
                      onChange={(e) => setFormData((prev) => ({ ...prev, address: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Street address"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">City *</label>
                      <input
                        type="text"
                        required
                        value={formData.city}
                        onChange={(e) => setFormData((prev) => ({ ...prev, city: e.target.value }))}
                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">State *</label>
                      <input
                        type="text"
                        required
                        value={formData.state}
                        onChange={(e) => setFormData((prev) => ({ ...prev, state: e.target.value }))}
                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Phone</label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="Optional"
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.is_active}
                      onChange={(e) => setFormData((prev) => ({ ...prev, is_active: e.target.checked }))}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700">Station active</span>
                  </label>
                  <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
                    <button
                      type="button"
                      onClick={handleCloseModal}
                      className="px-4 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
                    >
                      {editingId ? 'Update Station' : 'Create Station'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Delete Confirmation Modal */}
          {showDeleteConfirm && (
            <div
              className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  setShowDeleteConfirm(false)
                  setDeleteId(null)
                }
              }}
            >
              <div
                className="bg-white rounded-xl shadow-xl p-8 max-w-md w-full"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 className="text-xl font-bold text-red-600 mb-4">Delete Station</h2>
                <p className="text-gray-700 mb-6">
                  Are you sure you want to delete this station? This action cannot be undone.
                </p>
                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowDeleteConfirm(false)
                      setDeleteId(null)
                    }}
                    className="px-4 py-2.5 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 font-medium transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </CompanyProvider>
  )
}
