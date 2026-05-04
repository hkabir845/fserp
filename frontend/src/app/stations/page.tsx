'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Sidebar from '@/components/Sidebar'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { Plus, Edit, Trash2, Search, Building2, AlertTriangle, RefreshCw, Phone, MapPin, Fuel, Sprout } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api, { getApiDocsUrl } from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { stationHasFuelForecourt } from '@/utils/stationCapabilities'

interface Station {
  id: number
  station_number: string
  station_name: string
  address_line1: string
  city: string
  state: string
  is_active: boolean
  phone?: string
  operates_fuel_retail?: boolean
  default_aquaculture_pond_id?: number | null
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
    is_active: true,
    operates_fuel_retail: true,
    default_aquaculture_pond_id: '',
  })
  const [aquaculturePonds, setAquaculturePonds] = useState<{ id: number; name: string }[]>([])
  const [stationMode, setStationMode] = useState<'single' | 'multi'>('single')
  /** Show fuel vs hub toggle when tenant is licensed for Aquaculture (platform feature). */
  const [aquacultureLicensed, setAquacultureLicensed] = useState(false)

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    fetchStations()
  }, [router])

  useEffect(() => {
    if (!showModal) return
    void (async () => {
      try {
        const { data } = await api.get<{ id: number; name: string }[]>('/aquaculture/ponds/')
        setAquaculturePonds(Array.isArray(data) ? data : [])
      } catch {
        setAquaculturePonds([])
      }
    })()
  }, [showModal])

  const fetchStations = async () => {
    setLoading(true)
    setError(null)
    try {
      const [stationsRes, companyRes] = await Promise.all([
        api.get<Station[]>('/stations/'),
        api
          .get<{ station_mode?: string; aquaculture_licensed?: boolean }>('/companies/current/')
          .catch(() => ({ data: {} as { station_mode?: string; aquaculture_licensed?: boolean } })),
      ])
      setStations(stationsRes.data)
      const sm = String(companyRes.data?.station_mode ?? 'single').toLowerCase()
      setStationMode(sm === 'single' ? 'single' : 'multi')
      setAquacultureLicensed(Boolean(companyRes.data?.aquaculture_licensed))
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
      const createBody: Record<string, unknown> = {
        station_name: formData.station_name,
        address_line1: formData.address,
        city: formData.city,
        state: formData.state,
        phone: formData.phone || null,
        postal_code: '',
        is_active: formData.is_active,
      }
      if (formData.default_aquaculture_pond_id) {
        createBody.default_aquaculture_pond_id = parseInt(formData.default_aquaculture_pond_id, 10)
      }
      if (aquacultureLicensed) {
        createBody.operates_fuel_retail = formData.operates_fuel_retail
      }
      await api.post('/stations/', createBody)
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
      is_active: station.is_active,
      default_aquaculture_pond_id:
        station.default_aquaculture_pond_id != null ? String(station.default_aquaculture_pond_id) : '',
      operates_fuel_retail: stationHasFuelForecourt(station),
    })
    setShowModal(true)
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId) return
    try {
      const updateBody: Record<string, unknown> = {
        station_name: formData.station_name,
        address_line1: formData.address,
        city: formData.city,
        state: formData.state,
        phone: formData.phone || null,
        postal_code: '',
        is_active: formData.is_active,
        default_aquaculture_pond_id: formData.default_aquaculture_pond_id
          ? parseInt(formData.default_aquaculture_pond_id, 10)
          : null,
      }
      if (aquacultureLicensed) {
        updateBody.operates_fuel_retail = formData.operates_fuel_retail
      }
      await api.put(`/stations/${editingId}/`, updateBody)
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
      is_active: true,
      operates_fuel_retail: true,
      default_aquaculture_pond_id: '',
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

  const activeCount = stations.filter((s) => s.is_active).length
  const inactiveCount = stations.filter((s) => !s.is_active).length
  const atStationLimit = stationMode === 'single' && activeCount >= 1
  const onlyActiveStationId =
    activeCount === 1 ? stations.find((s) => s.is_active)?.id ?? null : null

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
        <div className="flex-1 overflow-auto app-scroll-pad">
          <div className="mb-4">
            <h1 className="text-3xl font-bold text-gray-900">Stations</h1>
            <p className="text-gray-600 mt-1 max-w-3xl">
              Manage operating locations: fuel forecourts, retail shops, and—when Aquaculture is licensed—dedicated farm or
              hub sites without underground fuel. Each site can be linked to a default pond for stock issues and POS.
            </p>

            <div
              className="mt-4 flex flex-col gap-3 rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              data-testid="station-site-overview"
            >
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span
                  className={
                    stationMode === 'single'
                      ? 'inline-flex shrink-0 items-center rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900'
                      : 'inline-flex shrink-0 items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-900'
                  }
                >
                  {stationMode === 'single'
                    ? 'Preference: single-site cap'
                    : 'Preference: multi-site allowed'}
                </span>
                <span className="text-sm text-slate-400 hidden sm:inline" aria-hidden>
                  |
                </span>
                <p className="text-sm text-slate-700">
                  <span className="font-semibold tabular-nums text-slate-900">{activeCount}</span> active site
                  {activeCount === 1 ? '' : 's'}
                  {inactiveCount > 0 ? (
                    <>
                      {' '}
                      · <span className="font-semibold tabular-nums text-slate-900">{inactiveCount}</span> inactive
                      <span className="text-slate-500"> (kept for history)</span>
                    </>
                  ) : null}
                </p>
              </div>
              <p className="text-sm text-slate-600 sm:max-w-md sm:text-right">
                {stationMode === 'single' ? (
                  <>
                    Company preference caps you at <span className="font-medium">one</span> active site; transfers and
                    auto-scoped flows still follow <span className="font-medium">how many are active</span> right now (
                    {activeCount}). Need another operating location?{' '}
                    <Link href="/company" className="font-medium text-blue-600 underline decoration-blue-600/30 hover:decoration-blue-600">
                      Set multiple sites
                    </Link>
                    , then add a station.
                  </>
                ) : (
                  <>
                    You may have several <span className="font-medium">active</span> depots ({activeCount} now). To stop
                    using a site without deleting it, open <span className="font-medium">Edit</span> and uncheck{' '}
                    <span className="font-medium">Station active</span>
                    . At least one must stay active. Site preference:{' '}
                    <Link href="/company" className="font-medium text-blue-600 underline decoration-blue-600/30 hover:decoration-blue-600">
                      Company profile
                    </Link>
                    .
                  </>
                )}
              </p>
            </div>
          </div>

          {stationMode === 'single' && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              <p className="font-medium">How single-site mode works</p>
              <p className="mt-1 text-amber-900/90">
                You can have <span className="font-semibold">one active</span> location. Sold or closed sites: edit the
                station and turn off <span className="font-semibold">Station active</span> to keep the row for history, or
                set{' '}
                <Link href="/company" className="font-semibold text-amber-950 underline">
                  Company profile
                </Link>{' '}
                to <span className="font-semibold">Multiple stations</span> to add more operating sites. You can still
                add <span className="font-semibold">inactive</span> site rows while one active site already exists
                (archived locations).
              </p>
            </div>
          )}

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
              disabled={atStationLimit}
              title={atStationLimit ? 'One active site: deactivate an existing station or set Multiple stations in Company profile to add more.' : undefined}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium shadow-sm shrink-0 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:hover:bg-gray-300"
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
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 sm:p-6 md:p-8">
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
                  disabled={atStationLimit}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors disabled:cursor-not-allowed disabled:bg-gray-300"
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
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                          station.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {station.is_active ? 'Active' : 'Inactive'}
                      </span>
                      {stationHasFuelForecourt(station) ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900">
                          <Fuel className="h-3 w-3" aria-hidden />
                          Fuel forecourt
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-900">
                          <Sprout className="h-3 w-3" aria-hidden />
                          Shop / aquaculture hub
                        </span>
                      )}
                    </div>
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
                    {stationHasFuelForecourt(station) ? (
                      <button
                        type="button"
                        onClick={() => router.push(`/tanks?station=${station.id}`)}
                        className="text-sm text-blue-600 hover:text-blue-800 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded"
                      >
                        Fuel tanks →
                      </button>
                    ) : (
                      <div className="min-w-0 text-xs leading-snug text-slate-600">
                        No fuel forecourt — use{' '}
                        <Link href="/cashier" className="font-medium text-blue-600 hover:underline">
                          Cashier
                        </Link>{' '}
                        for retail stock and{' '}
                        <Link href="/aquaculture" className="font-medium text-teal-700 hover:underline">
                          Aquaculture
                        </Link>{' '}
                        for pond economics.
                      </div>
                    )}
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
                className="bg-white rounded-xl shadow-xl app-modal-pad max-w-2xl w-full max-h-[90vh] overflow-y-auto"
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
                  {aquacultureLicensed ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50/90 p-4">
                      <div className="flex items-start gap-3">
                        <div className="rounded-lg bg-white p-2 shadow-sm ring-1 ring-slate-200">
                          <Fuel className="h-5 w-5 text-amber-700" aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900">Fuel forecourt at this site</p>
                          <p className="mt-1 text-xs leading-relaxed text-slate-600">
                            Turn <span className="font-medium">on</span> for locations with underground storage, tank dips,
                            islands, and dispensers. Turn <span className="font-medium">off</span> for aquaculture offices,
                            farm shops, or hubs with POS but no pump fuel—this keeps tank and nozzle setup lists clean.
                          </p>
                          <label className="mt-3 flex cursor-pointer items-center gap-3">
                            <input
                              type="checkbox"
                              checked={formData.operates_fuel_retail}
                              onChange={(e) =>
                                setFormData((prev) => ({ ...prev, operates_fuel_retail: e.target.checked }))
                              }
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm font-medium text-slate-800">
                              This station operates fuel retail (forecourt)
                            </span>
                          </label>
                          {!formData.operates_fuel_retail ? (
                            <p className="mt-2 text-xs text-amber-900/90">
                              You cannot attach fuel tanks or islands until this is enabled again—and only after any
                              existing forecourt equipment is removed from this station record in the database.
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                  {aquaculturePonds.length > 0 ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Default aquaculture pond (internal issue prefill)
                      </label>
                      <select
                        value={formData.default_aquaculture_pond_id}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, default_aquaculture_pond_id: e.target.value }))
                        }
                        className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white"
                      >
                        <option value="">None</option>
                        {aquaculturePonds.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-gray-500">
                        Pre-fills pond only for the optional “internal stock issue at cost” flow on Aquaculture
                        expenses. POS sales to ponds use the customer linked on each pond, not this field.
                      </p>
                    </div>
                  ) : null}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.is_active}
                      disabled={Boolean(editingId && editingId === onlyActiveStationId && stations.find((x) => x.id === editingId)?.is_active)}
                      onChange={(e) => setFormData((prev) => ({ ...prev, is_active: e.target.checked }))}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
                      title={
                        editingId && editingId === onlyActiveStationId
                          ? 'At least one active station is required. Activate another site first, then you can deactivate this one.'
                          : undefined
                      }
                    />
                    <span className="text-sm font-medium text-gray-700">Station active</span>
                  </label>
                  {editingId === onlyActiveStationId ? (
                    <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-2 py-1.5">
                      This is your only active location; the system blocks turning it off until another site is active.
                    </p>
                  ) : null}
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
                className="bg-white rounded-xl shadow-xl app-modal-pad max-w-md w-full"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 className="text-xl font-bold text-red-600 mb-4">Delete station</h2>
                <p className="text-gray-700 mb-6 text-sm leading-relaxed">
                  Permanently remove this site record. If the system still has linked history (for example, inventory
                  moves), deletion may be blocked—use <span className="font-medium">Edit</span> and uncheck Station
                  active to stop using the location instead.
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
