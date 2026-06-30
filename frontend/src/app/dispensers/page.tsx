'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { usePageMeta } from '@/hooks/usePageMeta'
import { Plus, Edit, Trash2, Search, Zap } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'

interface Dispenser {
  id: number
  dispenser_code: string
  dispenser_name: string
  island_id: number
  island_name?: string
  station_name?: string
  model: string
  serial_number: string
  meter_count?: number
  is_active: boolean
}

interface Island {
  id: number
  island_code: string
  island_name: string
  station_name?: string
  /** Mirrors parent station `operates_fuel_retail` from `/islands/` API. */
  station_operates_fuel_retail?: boolean
}

export default function DispensersPage() {
  const router = useRouter()
  const pageMeta = usePageMeta()
  const searchParams = useSearchParams()
  const toast = useToast()
  const [dispensers, setDispensers] = useState<Dispenser[]>([])
  const [islands, setIslands] = useState<Island[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [selectedIsland, setSelectedIsland] = useState<string>('')
  const [formData, setFormData] = useState({
    dispenser_name: '',
    island_id: 0,
    model: '',
    serial_number: '',
    manufacturer: '',
    is_active: true
  })

  /** Islands whose parent station operates fuel forecourt (`/islands/` exposes `station_operates_fuel_retail`). */
  const fuelForecourtIslands = useMemo(
    () => islands.filter((i) => i.station_operates_fuel_retail !== false),
    [islands],
  )

  useEffect(() => {
    if (!selectedIsland || !islands.length) return
    const ok = fuelForecourtIslands.some((i) => String(i.id) === selectedIsland)
    if (!ok) setSelectedIsland('')
  }, [selectedIsland, islands, fuelForecourtIslands])

  const buildModelField = () => {
    const m = formData.model.trim()
    const mf = formData.manufacturer.trim()
    if (mf && m) return `${mf} — ${m}`
    return mf || m
  }

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    
    const islandId = searchParams?.get('island')
    if (islandId) {
      setSelectedIsland(islandId)
    }
    
    fetchData()
  }, [router, searchParams])

  const fetchData = async () => {
    try {
      const [dispensersRes, islandsRes] = await Promise.allSettled([
        api.get('/dispensers/'),
        api.get('/islands/')
      ])

      if (dispensersRes.status === 'fulfilled') {
        setDispensers(dispensersRes.value.data)
      } else {
        console.error('❌ Dispensers API error:', dispensersRes.reason)
        const errorMessage = extractErrorMessage(dispensersRes.reason, 'Failed to load dispensers')
        toast.error(errorMessage)
      }
      
      if (islandsRes.status === 'fulfilled') {
        setIslands(islandsRes.value.data)
      } else {
        console.error('❌ Islands API error:', islandsRes.reason)
        // Don't show error for islands - it's not critical
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
    
    if (formData.island_id === 0) {
      toast.error('Please select an island')
      return
    }
    
    try {
      await api.post('/dispensers/', {
        dispenser_name: formData.dispenser_name,
        island_id: formData.island_id,
        model: buildModelField(),
        serial_number: formData.serial_number.trim(),
        is_active: formData.is_active
      })
      toast.success('Dispenser created successfully!')
      setShowModal(false)
      resetForm()
      fetchData()
    } catch (error) {
      console.error('Error creating dispenser:', error)
      const errorMessage = extractErrorMessage(error, 'Failed to create dispenser')
      toast.error(errorMessage)
    }
  }

  const handleEdit = (dispenser: Dispenser) => {
    setEditingId(dispenser.id)
    const raw = (dispenser.model || '').trim()
    const sep = raw.indexOf(' — ')
    const manufacturer = sep >= 0 ? raw.slice(0, sep).trim() : ''
    const modelOnly = sep >= 0 ? raw.slice(sep + 3).trim() : raw
    setFormData({
      dispenser_name: dispenser.dispenser_name,
      island_id: dispenser.island_id,
      model: modelOnly,
      serial_number: dispenser.serial_number || '',
      manufacturer,
      is_active: dispenser.is_active
    })
    setShowModal(true)
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId) return
    
    if (formData.island_id === 0) {
      toast.error('Please select an island')
      return
    }
    
    try {
      await api.put(`/dispensers/${editingId}/`, {
        dispenser_name: formData.dispenser_name,
        island_id: formData.island_id,
        model: buildModelField(),
        serial_number: formData.serial_number.trim(),
        is_active: formData.is_active
      })
      toast.success('Dispenser updated successfully!')
      setShowModal(false)
      resetForm()
      fetchData()
    } catch (error) {
      console.error('Error updating dispenser:', error)
      const errorMessage = extractErrorMessage(error, 'Failed to update dispenser')
      toast.error(errorMessage)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    
    try {
      await api.delete(`/dispensers/${deleteId}/`)
      toast.success('Dispenser deleted successfully!')
      setShowDeleteConfirm(false)
      setDeleteId(null)
      fetchData()
    } catch (error) {
      console.error('Error deleting dispenser:', error)
      const errorMessage = extractErrorMessage(error, 'Failed to delete dispenser')
      toast.error(errorMessage)
    }
  }

  const resetForm = () => {
    setFormData({
      dispenser_name: '',
      island_id: 0,
      model: '',
      serial_number: '',
      manufacturer: '',
      is_active: true
    })
    setEditingId(null)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    resetForm()
  }

  const filteredDispensers = dispensers.filter(dispenser => {
    const matchesSearch = dispenser.dispenser_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         dispenser.dispenser_code.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesIsland = !selectedIsland || dispenser.island_id.toString() === selectedIsland
    return matchesSearch && matchesIsland
  })

  return (
    <PageLayout>
      <ErpPageShell
        showBackLink={false}
        title={pageMeta.title}
        titleIcon={Zap}
        description={pageMeta.description}
        maxWidthClass="max-w-[1600px]"
        contentClassName="mt-4"
        actions={
          <button
            onClick={() => setShowModal(true)}
            className="erp-btn-cta"
          >
            <Plus className="h-5 w-5" />
            <span>Add Dispenser</span>
          </button>
        }
      >
        {islands.length > 0 && fuelForecourtIslands.length === 0 ? (
          <div className="erp-alert-warning mb-6">
            No fuel-forecourt islands — configure at least one fuel retail station with islands before adding
            dispensers.
          </div>
        ) : null}

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="erp-search-icon" />
              <input
                type="text"
                placeholder="Search dispensers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="erp-field pl-10"
              />
            </div>
            
            <select
              value={selectedIsland}
              onChange={(e) => setSelectedIsland(e.target.value)}
              className="erp-field w-auto min-w-[12rem]"
            >
              <option value="">All fuel islands</option>
              {fuelForecourtIslands.map((island) => (
                <option key={island.id} value={island.id}>
                  {island.island_name} ({island.station_name})
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="erp-loading-spinner h-12 w-12"></div>
          </div>
        ) : filteredDispensers.length === 0 ? (
          <div className="erp-empty-state">
            <Zap className="h-16 w-16 text-muted-foreground/40 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">No dispensers found</h3>
            <p className="text-muted-foreground mb-4">Get started by creating your first fuel dispenser</p>
            <button
              onClick={() => setShowModal(true)}
              className="erp-btn-cta"
            >
              <Plus className="h-5 w-5" />
              <span>Add Dispenser</span>
            </button>
          </div>
        ) : (
          (() => {
            // Auto-sizing logic: cards scale based on count
            const dispenserCount = filteredDispensers.length
            let gridCols = 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
            let cardPadding = 'p-6'
            let cardGap = 'gap-6'
            let fontSize = {
              title: 'text-lg',
              subtitle: 'text-sm',
              value: 'text-base',
              label: 'text-xs',
              icon: 'h-6 w-6'
            }
            
            if (dispenserCount <= 3) {
              gridCols = 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              cardPadding = 'p-4 sm:p-6 md:p-8'
              cardGap = 'gap-6'
              fontSize = {
                title: 'text-2xl',
                subtitle: 'text-base',
                value: 'text-xl',
                label: 'text-sm',
                icon: 'h-8 w-8'
              }
            } else if (dispenserCount <= 6) {
              gridCols = 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              cardPadding = 'p-6'
              cardGap = 'gap-6'
              fontSize = {
                title: 'text-xl',
                subtitle: 'text-sm',
                value: 'text-lg',
                label: 'text-xs',
                icon: 'h-6 w-6'
              }
            } else if (dispenserCount <= 9) {
              gridCols = 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              cardPadding = 'p-5'
              cardGap = 'gap-5'
              fontSize = {
                title: 'text-lg',
                subtitle: 'text-sm',
                value: 'text-base',
                label: 'text-xs',
                icon: 'h-5 w-5'
              }
            } else {
              gridCols = 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              cardPadding = 'p-4'
              cardGap = 'gap-4'
              fontSize = {
                title: 'text-base',
                subtitle: 'text-xs',
                value: 'text-sm',
                label: 'text-[10px]',
                icon: 'h-4 w-4'
              }
            }
            
            return (
              <div className={`grid ${gridCols} ${cardGap} overflow-y-auto max-h-[calc(100vh-250px)] pr-2`}>
                {filteredDispensers.map((dispenser) => (
                  <div key={dispenser.id} className={`erp-surface-interactive border-2 ${cardPadding}`}>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center space-x-3">
                        <div className="erp-metric-icon erp-metric-icon--success h-12 w-12">
                          <Zap className={`${fontSize.icon}`} />
                        </div>
                        <div>
                          <h3 className={`font-bold ${fontSize.title} text-foreground`}>{dispenser.dispenser_name}</h3>
                          <p className={`${fontSize.subtitle} text-muted-foreground`}>{dispenser.dispenser_code}</p>
                        </div>
                      </div>
                      <span className={`px-2 py-1 rounded-full ${fontSize.label} font-semibold ${
                        dispenser.is_active ? 'erp-badge--success' : 'erp-badge--danger'
                      }`}>
                        {dispenser.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    
                    <div className="space-y-2 mb-4">
                      <div>
                        <p className={`${fontSize.label} text-muted-foreground mb-1`}>Island</p>
                        <p className={`${fontSize.subtitle} font-medium text-foreground`}>{dispenser.island_name || 'N/A'}</p>
                      </div>
                      
                      <div>
                        <p className={`${fontSize.label} text-muted-foreground mb-1`}>Station</p>
                        <p className={`${fontSize.subtitle} text-foreground/85`}>{dispenser.station_name || 'N/A'}</p>
                      </div>
                      
                      {dispenser.model && (
                        <div>
                          <p className={`${fontSize.label} text-muted-foreground mb-1`}>Model</p>
                          <p className={`${fontSize.subtitle} text-foreground/85`}>{dispenser.model}</p>
                        </div>
                      )}
                      
                      {dispenser.serial_number && (
                        <div>
                          <p className={`${fontSize.label} text-muted-foreground mb-1`}>Serial Number</p>
                          <p className={`${fontSize.subtitle} text-foreground/85 font-mono`}>{dispenser.serial_number}</p>
                        </div>
                      )}
                      
                      <div className="flex items-center justify-between pt-2 border-t">
                        <div>
                          <p className={`${fontSize.label} text-muted-foreground`}>Meters</p>
                          <p className={`${fontSize.value} erp-stat-highlight`}>{dispenser.meter_count || 0}</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-4 border-t">
                      <button
                        onClick={() => router.push(`/meters?dispenser=${dispenser.id}`)}
                        className={`erp-link ${fontSize.label}`}
                      >
                        View Meters →
                      </button>
                      <div className="flex items-center space-x-2">
                        <button 
                          onClick={() => handleEdit(dispenser)}
                          className="erp-icon-btn-primary"
                          title="Edit Dispenser"
                        >
                          <Edit className={`${fontSize.icon}`} />
                        </button>
                        <button 
                          onClick={() => {
                            setDeleteId(dispenser.id)
                            setShowDeleteConfirm(true)
                          }}
                          className="erp-icon-btn-danger"
                          title="Delete Dispenser"
                        >
                          <Trash2 className={`${fontSize.icon}`} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          })()
        )}

        {/* Create/Edit Modal */}
        {showModal && (
          <div className="erp-modal-backdrop">
            <div className="erp-modal max-w-2xl">
              <h2 className="mb-6 text-2xl font-bold text-foreground">{editingId ? 'Edit Dispenser' : 'Add New Dispenser'}</h2>
              <form onSubmit={editingId ? handleUpdate : handleCreate}>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      Dispenser Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.dispenser_name}
                      onChange={(e) => setFormData({ ...formData, dispenser_name: e.target.value })}
                      className="erp-field"
                      placeholder="e.g., Pump 1, Dispenser A"
                    />
                  </div>
                  
                  <div className="col-span-2">
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      Island *
                    </label>
                    <select
                      required
                      value={formData.island_id}
                      onChange={(e) => setFormData({ ...formData, island_id: parseInt(e.target.value) })}
                      className="erp-field"
                    >
                      <option value={0}>Select Island</option>
                      {fuelForecourtIslands.map((island) => (
                        <option key={island.id} value={island.id}>
                          {island.island_name} - {island.station_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      Model
                    </label>
                    <input
                      type="text"
                      value={formData.model}
                      onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                      className="erp-field"
                      placeholder="e.g., Gilbarco, Wayne"
                    />
                  </div>
                  
                  <div>
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      Manufacturer / brand
                    </label>
                    <input
                      type="text"
                      value={formData.manufacturer}
                      onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })}
                      className="erp-field"
                      placeholder="e.g. Gilbarco"
                    />
                  </div>
                  
                  <div className="col-span-2">
                    <label className="mb-2 block text-sm font-medium text-foreground">
                      Serial Number
                    </label>
                    <input
                      type="text"
                      value={formData.serial_number}
                      onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })}
                      className="erp-field"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.is_active}
                        onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                        className="rounded border-input text-primary focus:ring-ring"
                      />
                      <span className="text-sm font-medium text-foreground/85">Dispenser active</span>
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
                    {editingId ? 'Update Dispenser' : 'Create Dispenser'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="erp-modal-backdrop">
            <div className="erp-modal max-w-md">
              <h2 className="mb-4 text-2xl font-bold text-destructive">Delete Dispenser</h2>
              <p className="mb-6 text-foreground/85">
                Are you sure you want to delete this dispenser? This action cannot be undone.
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false)
                    setDeleteId(null)
                  }}
                  className="erp-btn-secondary"
                >
                  Cancel
                </button>
                <button
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
  )
}





