'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { Plus, Edit, Trash2, Search, Building2, AlertTriangle, RefreshCw, Phone, MapPin, Fuel, Sprout } from 'lucide-react'
import { useToast } from '@/components/Toast'
import { usePageMeta } from '@/hooks/usePageMeta'
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
  const pageMeta = usePageMeta()
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
      setError(errorMessage)
      toast.error(errorMessage)
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
      <PageLayout>
        <ErpPageShell
          showBackLink={false}
          titleId="stations-title"
          eyebrow={pageMeta.eyebrow}
          eyebrowIcon={pageMeta.eyebrow ? MapPin : undefined}
          title={pageMeta.title}
          titleIcon={MapPin}
          description={pageMeta.description ?? undefined}
          maxWidthClass="max-w-[1600px]"
          contentClassName="mt-4"
          actions={
            <button
              onClick={() => {
                resetForm()
                setShowModal(true)
              }}
              disabled={atStationLimit}
              title={atStationLimit ? 'One active site: deactivate an existing station or set Multiple stations in Company profile to add more.' : undefined}
              className="erp-btn-cta shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-5 w-5" />
              <span>Add Station</span>
            </button>
          }
        >
          <div
            className="erp-surface mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
            data-testid="station-site-overview"
          >
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <span
                  className={
                    stationMode === 'single'
                      ? 'inline-flex shrink-0 items-center rounded-full border border-amber-300 bg-warning/10 px-3 py-1 text-xs font-semibold text-warning-foreground'
                      : 'inline-flex shrink-0 items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-900'
                  }
                >
                  {stationMode === 'single'
                    ? 'Preference: single-site cap'
                    : 'Preference: multi-site allowed'}
                </span>
                <span className="text-sm text-muted-foreground/70 hidden sm:inline" aria-hidden>
                  |
                </span>
                <p className="text-sm text-foreground/85">
                  <span className="font-semibold tabular-nums text-foreground">{activeCount}</span> active site
                  {activeCount === 1 ? '' : 's'}
                  {inactiveCount > 0 ? (
                    <>
                      {' '}
                      · <span className="font-semibold tabular-nums text-foreground">{inactiveCount}</span> inactive
                      <span className="text-muted-foreground"> (kept for history)</span>
                    </>
                  ) : null}
                </p>
              </div>
              <p className="text-sm text-muted-foreground sm:max-w-md sm:text-right">
                {stationMode === 'single' ? (
                  <>
                    Company preference caps you at <span className="font-medium">one</span> active site; transfers and
                    auto-scoped flows still follow <span className="font-medium">how many are active</span> right now (
                    {activeCount}). Need another operating location?{' '}
                    <Link href="/company" className="font-medium text-primary underline decoration-primary/30 hover:decoration-primary">
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
                    <Link href="/company" className="font-medium text-primary underline decoration-primary/30 hover:decoration-primary">
                      Company profile
                    </Link>
                    .
                  </>
                )}
              </p>
            </div>

          {stationMode === 'single' && (
            <div className="erp-alert-warning mb-4">
              <p className="font-medium">How single-site mode works</p>
              <p className="mt-1 text-warning-foreground/90">
                You can have <span className="font-semibold">one active</span> location. Sold or closed sites: edit the
                station and turn off <span className="font-semibold">Station active</span> to keep the row for history, or
                set{' '}
                <Link href="/company" className="font-semibold text-warning-foreground underline">
                  Company profile
                </Link>{' '}
                to <span className="font-semibold">Multiple stations</span> to add more operating sites. You can still
                add <span className="font-semibold">inactive</span> site rows while one active site already exists
                (archived locations).
              </p>
            </div>
          )}

          <div className="mb-6 flex flex-wrap items-center gap-4">
            <div className="relative min-w-0 max-w-md flex-1">
              <Search className="erp-search-icon" />
              <input
                type="text"
                placeholder="Search stations..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="erp-field pl-10 shadow-sm"
              />
            </div>
          </div>

          {loading ? (
            <div className="space-y-4">
              <div className="erp-surface animate-pulse p-6">
                <div className="h-4 bg-muted rounded w-3/4 mb-4" />
                <div className="h-4 bg-muted rounded w-1/2" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div
                    key={i}
                    className="erp-surface h-56 animate-pulse p-6"
                  >
                    <div className="h-12 bg-muted rounded-lg w-2/3 mb-4" />
                    <div className="h-4 bg-muted rounded w-full mb-2" />
                    <div className="h-4 bg-muted rounded w-4/5" />
                  </div>
                ))}
              </div>
            </div>
          ) : error ? (
            <div className="bg-destructive/5 border border-destructive/25 rounded-xl p-4 sm:p-6 md:p-8">
              <div className="text-center mb-6">
                <AlertTriangle className="h-16 w-16 text-destructive mx-auto mb-4" />
                <h3 className="text-xl font-bold text-destructive mb-2">Error Loading Stations</h3>
                <p className="text-destructive whitespace-pre-line text-left max-w-2xl mx-auto mb-6">{error}</p>
              </div>
              {(error.includes('run.bat') || error.includes('ERR_CONNECTION') || error.includes('ERR_NETWORK')) && (
                <div className="erp-surface mb-6 max-w-3xl border border-destructive/30 p-6 text-left">
                  <p className="text-sm font-semibold text-destructive mb-2">To start the backend:</p>
                  <div className="bg-muted p-3 rounded font-mono text-xs text-foreground">
                    cd backend<br />
                    python manage.py runserver 8000
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Or run <code className="bg-muted px-1 rounded">backend\run.bat</code></p>
                  <p className="text-xs text-primary mt-3">
                    Verify at <a href={apiDocsUrl} target="_blank" rel="noopener noreferrer" className="underline">{apiDocsUrl}</a> (DEBUG)
                  </p>
                </div>
              )}
              <div className="flex flex-wrap justify-center gap-3">
                <button
                  onClick={fetchStations}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-destructive text-white rounded-lg hover:bg-destructive/90 transition-colors font-medium"
                >
                  <RefreshCw className="h-5 w-5" />
                  <span>Retry</span>
                </button>
                <a
                  href={apiDocsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-6 py-3 border border-destructive/30 text-destructive rounded-lg hover:bg-destructive/10 transition-colors font-medium"
                >
                  Check Backend
                </a>
              </div>
            </div>
          ) : filteredStations.length === 0 ? (
            <div className="erp-empty-state">
              <div className="p-4 bg-muted rounded-full w-fit mx-auto mb-4">
                <Building2 className="h-16 w-16 text-muted-foreground/70" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">No stations found</h3>
              <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                {stations.length === 0
                  ? 'Get started by adding your first filling station location.'
                  : 'No stations match your search. Try a different term.'}
              </p>
              {stations.length === 0 && (
                <button
                  onClick={() => setShowModal(true)}
                  disabled={atStationLimit}
                  className="erp-btn-cta disabled:cursor-not-allowed disabled:opacity-50"
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
                  className="erp-surface-interactive flex flex-col p-6"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="erp-metric-icon erp-metric-icon--info h-12 w-12 shrink-0">
                        <Building2 className="h-6 w-6" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-bold text-lg text-foreground truncate" title={station.station_name}>
                          {station.station_name}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {station.station_number || `#${station.id}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                          station.is_active ? 'erp-badge--success' : 'erp-badge--danger'
                        }`}
                      >
                        {station.is_active ? 'Active' : 'Inactive'}
                      </span>
                      {stationHasFuelForecourt(station) ? (
                        <span className="erp-badge erp-badge--warning inline-flex items-center gap-1 px-2 py-0.5 text-[11px]">
                          <Fuel className="h-3 w-3" aria-hidden />
                          Fuel forecourt
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-accent px-2 py-0.5 text-[11px] font-medium text-primary">
                          <Sprout className="h-3 w-3" aria-hidden />
                          Shop / aquaculture hub
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="space-y-2 mb-4 flex-1">
                    <div className="flex gap-2 text-sm text-muted-foreground">
                      <MapPin className="h-4 w-4 shrink-0 text-muted-foreground/70 mt-0.5" />
                      <span className="line-clamp-2">{formatAddress(station)}</span>
                    </div>
                    {station.phone && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Phone className="h-4 w-4 shrink-0 text-muted-foreground/70" />
                        <span>{station.phone}</span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-border/70">
                    {stationHasFuelForecourt(station) ? (
                      <button
                        type="button"
                        onClick={() => router.push(`/tanks?station=${station.id}`)}
                        className="erp-link"
                      >
                        Fuel tanks →
                      </button>
                    ) : (
                      <div className="min-w-0 text-xs leading-snug text-muted-foreground">
                        No fuel forecourt — use{' '}
                        <Link href="/cashier" className="erp-link hover:underline">
                          Cashier
                        </Link>{' '}
                        for retail stock and{' '}
                        <Link href="/aquaculture" className="font-medium text-primary hover:underline">
                          Aquaculture
                        </Link>{' '}
                        for pond P&amp;L, costs, and harvest sales.
                      </div>
                    )}
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleEdit(station)}
                        className="erp-icon-btn-primary"
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
                        className="erp-icon-btn-danger"
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
              className="erp-modal-backdrop"
              onClick={(e) => e.target === e.currentTarget && handleCloseModal()}
            >
              <div
                className="erp-modal max-w-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 className="mb-6 text-2xl font-bold text-foreground">
                  {editingId ? 'Edit Station' : 'Add New Station'}
                </h2>
                <form onSubmit={editingId ? handleUpdate : handleCreate} className="space-y-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-foreground">Station Name *</label>
                    <input
                      type="text"
                      required
                      value={formData.station_name}
                      onChange={(e) => setFormData((prev) => ({ ...prev, station_name: e.target.value }))}
                      className="erp-field"
                      placeholder="e.g., Downtown Station"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-foreground">Address *</label>
                    <input
                      type="text"
                      required
                      value={formData.address}
                      onChange={(e) => setFormData((prev) => ({ ...prev, address: e.target.value }))}
                      className="erp-field"
                      placeholder="Street address"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-foreground">City *</label>
                      <input
                        type="text"
                        required
                        value={formData.city}
                        onChange={(e) => setFormData((prev) => ({ ...prev, city: e.target.value }))}
                        className="erp-field"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-foreground">State *</label>
                      <input
                        type="text"
                        required
                        value={formData.state}
                        onChange={(e) => setFormData((prev) => ({ ...prev, state: e.target.value }))}
                        className="erp-field"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-foreground">Phone</label>
                    <input
                      type="tel"
                      value={formData.phone}
                      onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))}
                      className="erp-field"
                      placeholder="Optional"
                    />
                  </div>
                  {aquacultureLicensed ? (
                    <div className="rounded-xl border border-border bg-muted/50 p-4">
                      <div className="flex items-start gap-3">
                        <div className="rounded-lg bg-card p-2 shadow-sm ring-1 ring-border">
                          <Fuel className="h-5 w-5 text-warning-foreground" aria-hidden />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-foreground">Fuel forecourt at this site</p>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
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
                              className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
                            />
                            <span className="text-sm font-medium text-foreground">
                              This station operates fuel retail (forecourt)
                            </span>
                          </label>
                          {!formData.operates_fuel_retail ? (
                            <p className="mt-2 text-xs text-warning-foreground/90">
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
                      <label className="mb-1.5 block text-sm font-medium text-foreground">
                        Default aquaculture pond (internal issue prefill)
                      </label>
                      <select
                        value={formData.default_aquaculture_pond_id}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, default_aquaculture_pond_id: e.target.value }))
                        }
                        className="erp-field"
                      >
                        <option value="">None</option>
                        {aquaculturePonds.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-muted-foreground">
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
                      className="rounded border-input text-primary focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                      title={
                        editingId && editingId === onlyActiveStationId
                          ? 'At least one active station is required. Activate another site first, then you can deactivate this one.'
                          : undefined
                      }
                    />
                    <span className="text-sm font-medium text-foreground/85">Station active</span>
                  </label>
                  {editingId === onlyActiveStationId ? (
                    <p className="text-xs text-warning-foreground bg-warning/10 border border-amber-100 rounded-md px-2 py-1.5">
                      This is your only active location; the system blocks turning it off until another site is active.
                    </p>
                  ) : null}
                  <div className="flex justify-end gap-3 pt-4 border-t border-border">
                    <button
                      type="button"
                      onClick={handleCloseModal}
                      className="erp-btn-secondary-lg"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="erp-btn-primary"
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
              className="erp-modal-backdrop"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  setShowDeleteConfirm(false)
                  setDeleteId(null)
                }
              }}
            >
              <div
                className="erp-modal max-w-md"
                onClick={(e) => e.stopPropagation()}
              >
                <h2 className="mb-4 text-xl font-bold text-destructive">Delete station</h2>
                <p className="mb-6 text-sm leading-relaxed text-foreground/85">
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
                    className="erp-btn-secondary-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    className="erp-btn-danger"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          )}
        </ErpPageShell>
      </PageLayout>
    </CompanyProvider>
  )
}
