'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { usePageMeta } from '@/hooks/usePageMeta'
import { Plus, Edit, Trash2, Search, MapPin } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { filterFuelForecourtStations } from '@/utils/stationCapabilities'

interface Island {
  id: number
  island_code: string
  island_name: string
  station_id: number
  station_name?: string
  station_operates_fuel_retail?: boolean
  location_description: string
  dispenser_count?: number
  is_active: boolean
}

interface Station {
  id: number
  station_number?: string
  station_name: string
  operates_fuel_retail?: boolean
}

export default function IslandsPage() {
  const router = useRouter()
  const pageMeta = usePageMeta()
  const toast = useToast()
  const [islands, setIslands] = useState<Island[]>([])
  const [stations, setStations] = useState<Station[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [selectedStation, setSelectedStation] = useState<string>('')
  const [formData, setFormData] = useState({
    island_name: '',
    station_id: 0,
    location_description: '',
    is_active: true
  })

  const fuelForecourtStations = useMemo(() => filterFuelForecourtStations(stations), [stations])

  useEffect(() => {
    if (selectedStation && !fuelForecourtStations.some((s) => String(s.id) === selectedStation)) {
      setSelectedStation('')
    }
  }, [selectedStation, fuelForecourtStations])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    fetchData()
  }, [router])

  const fetchData = async () => {
    try {
      const [islandsRes, stationsRes] = await Promise.allSettled([
        api.get('/islands/'),
        api.get('/stations/')
      ])

      if (islandsRes.status === 'fulfilled') {
        setIslands(islandsRes.value.data)
      } else {
        console.error('❌ Islands API error:', islandsRes.reason)
        const errorMessage = extractErrorMessage(islandsRes.reason, 'Failed to load islands')
        toast.error(errorMessage)
      }
      
      if (stationsRes.status === 'fulfilled') {
        setStations(stationsRes.value.data)
      } else {
        console.error('❌ Stations API error:', stationsRes.reason)
        // Don't show error for stations - it's not critical
      }
      
    } catch (error) {
      console.error('❌ Error fetching data:', error)
      const errorMessage = extractErrorMessage(error, 'Error connecting to server')
      toast.error(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (formData.station_id === 0) {
      toast.error('Please select a station')
      return
    }
    
    try {
      await api.post('/islands/', formData)
      toast.success('Island created successfully!')
      setShowModal(false)
      resetForm()
      fetchData()
    } catch (error) {
      console.error('Error creating island:', error)
      const errorMessage = extractErrorMessage(error, 'Failed to create island')
      toast.error(errorMessage)
    }
  }

  const handleEdit = (island: Island) => {
    setEditingId(island.id)
    setFormData({
      island_name: island.island_name,
      station_id: island.station_id,
      location_description: island.location_description || '',
      is_active: island.is_active
    })
    setShowModal(true)
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId) return
    
    if (formData.station_id === 0) {
      toast.error('Please select a station')
      return
    }
    
    try {
      await api.put(`/islands/${editingId}/`, {
        island_name: formData.island_name,
        station_id: formData.station_id,
        location_description: formData.location_description,
        is_active: formData.is_active
      })
      toast.success('Island updated successfully!')
      setShowModal(false)
      resetForm()
      fetchData()
    } catch (error) {
      console.error('Error updating island:', error)
      const errorMessage = extractErrorMessage(error, 'Failed to update island')
      toast.error(errorMessage)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    
    try {
      await api.delete(`/islands/${deleteId}/`)
      toast.success('Island deleted successfully!')
      setShowDeleteConfirm(false)
      setDeleteId(null)
      fetchData()
    } catch (error) {
      console.error('Error deleting island:', error)
      const errorMessage = extractErrorMessage(error, 'Failed to delete island')
      toast.error(errorMessage)
    }
  }

  const resetForm = () => {
    setFormData({
      island_name: '',
      station_id: 0,
      location_description: '',
      is_active: true
    })
    setEditingId(null)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    resetForm()
  }

  const filteredIslands = islands.filter(island => {
    const matchesSearch = island.island_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (island.island_code || '').toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStation = !selectedStation || island.station_id.toString() === selectedStation
    return matchesSearch && matchesStation
  })

  return (
    <PageLayout>
      <ErpPageShell
        showBackLink={false}
        title={pageMeta.title}
        titleIcon={MapPin}
        description={pageMeta.description}
        maxWidthClass="max-w-[1600px]"
        contentClassName="mt-4"
        actions={
          <button
            onClick={() => setShowModal(true)}
            className="erp-btn-cta"
          >
            <Plus className="h-5 w-5" />
            <span>Add Island</span>
          </button>
        }
      >
        {stations.length > 0 && fuelForecourtStations.length === 0 ? (
          <div className="mb-6 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
            No fuel-forecourt sites defined — islands attach only to stations with fuel retail enabled under Stations.
          </div>
        ) : null}

        <div className="mb-6 flex items-center justify-between">
          <div className="flex flex-1 items-center space-x-4">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 transform text-muted-foreground" />
              <input
                type="text"
                placeholder="Search islands..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="erp-field pl-10"
              />
            </div>
            
            <select
              value={selectedStation}
              onChange={(e) => setSelectedStation(e.target.value)}
              className="erp-field w-auto min-w-[12rem]"
            >
              <option value="">All fuel forecourt stations</option>
              {fuelForecourtStations.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.station_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center">
            <div className="erp-loading-spinner" />
          </div>
        ) : filteredIslands.length === 0 ? (
          <div className="erp-empty-state">
            <MapPin className="mx-auto mb-4 h-16 w-16 text-muted-foreground/40" />
            <h3 className="mb-2 text-lg font-medium text-foreground">No islands found</h3>
            <p className="mb-4 text-muted-foreground">Get started by creating your first pump island</p>
            <button
              onClick={() => setShowModal(true)}
              className="erp-btn-cta"
            >
              <Plus className="h-5 w-5" />
              <span>Add Island</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredIslands.map((island) => (
              <div key={island.id} className="erp-surface-interactive p-6">
                <div className="mb-4 flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="erp-metric-icon erp-metric-icon--accent h-12 w-12">
                      <MapPin className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-foreground">{island.island_name}</h3>
                      <p className="text-sm text-muted-foreground">{island.island_code}</p>
                    </div>
                  </div>
                  <span className={`erp-badge ${island.is_active ? 'erp-badge--success' : 'erp-badge--danger'}`}>
                    {island.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                
                <div className="mb-4 space-y-2">
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">Station</p>
                    <p className="text-sm font-medium text-foreground">{island.station_name || 'N/A'}</p>
                  </div>
                  
                  {island.location_description && (
                    <div>
                      <p className="mb-1 text-xs text-muted-foreground">Location</p>
                      <p className="text-sm text-foreground/85">{island.location_description}</p>
                    </div>
                  )}
                  
                  <div className="flex items-center justify-between border-t border-border pt-2">
                    <div>
                      <p className="text-xs text-muted-foreground">Dispensers</p>
                      <p className="erp-stat-highlight">{island.dispenser_count || 0}</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between border-t border-border pt-4">
                  <button
                    onClick={() => router.push(`/dispensers?island=${island.id}`)}
                    className="erp-link"
                  >
                    View Dispensers →
                  </button>
                  <div className="flex items-center space-x-2">
                    <button 
                      onClick={() => handleEdit(island)}
                      className="rounded p-2 text-primary hover:bg-accent"
                      title="Edit Island"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button 
                      onClick={() => {
                        setDeleteId(island.id)
                        setShowDeleteConfirm(true)
                      }}
                      className="rounded p-2 text-destructive hover:bg-destructive/10"
                      title="Delete Island"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="erp-surface app-modal-pad w-full max-w-2xl">
              <h2 className="mb-6 text-2xl font-bold text-foreground">{editingId ? 'Edit Island' : 'Add New Island'}</h2>
              <form onSubmit={editingId ? handleUpdate : handleCreate}>
                <div className="space-y-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      Island Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.island_name}
                      onChange={(e) => setFormData({ ...formData, island_name: e.target.value })}
                      className="erp-field"
                      placeholder="e.g., Island 1, North Island"
                    />
                  </div>
                  
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      Station *
                    </label>
                    <select
                      required
                      value={formData.station_id}
                      onChange={(e) => setFormData({ ...formData, station_id: parseInt(e.target.value) })}
                      className="erp-field"
                    >
                      <option value={0}>Select Station</option>
                      {fuelForecourtStations.map((station) => (
                        <option key={station.id} value={station.id}>
                          {station.station_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      Location Description
                    </label>
                    <textarea
                      value={formData.location_description}
                      onChange={(e) => setFormData({ ...formData, location_description: e.target.value })}
                      className="erp-field"
                      rows={3}
                      placeholder="e.g., Front entrance, near highway"
                    />
                  </div>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      className="rounded border-input text-primary focus:ring-ring"
                    />
                    <span className="text-sm font-medium text-foreground">Island active</span>
                  </label>
                </div>
                
                <div className="mt-6 flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="erp-btn-primary"
                  >
                    {editingId ? 'Update Island' : 'Create Island'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="erp-surface app-modal-pad w-full max-w-md">
              <h2 className="mb-4 text-2xl font-bold text-destructive">Delete Island</h2>
              <p className="mb-6 text-foreground/85">
                Are you sure you want to delete this island? This action cannot be undone.
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false)
                    setDeleteId(null)
                  }}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className="rounded-lg bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </ErpPageShell>
    </PageLayout>
  )
}





