'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
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
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto app-scroll-pad">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Dispensers</h1>
          <p className="text-gray-600 mt-1 max-w-3xl">
            Dispensers attach only to islands on fuel forecourt stations (see Stations).
          </p>
          {islands.length > 0 && fuelForecourtIslands.length === 0 ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              No fuel-forecourt islands — configure at least one fuel retail station with islands before adding
              dispensers.
            </div>
          ) : null}
        </div>

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
              <input
                type="text"
                placeholder="Search dispensers..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <select
              value={selectedIsland}
              onChange={(e) => setSelectedIsland(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All fuel islands</option>
              {fuelForecourtIslands.map((island) => (
                <option key={island.id} value={island.id}>
                  {island.island_name} ({island.station_name})
                </option>
              ))}
            </select>
          </div>
          
          <button
            onClick={() => setShowModal(true)}
            className="ml-4 flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="h-5 w-5" />
            <span>Add Dispenser</span>
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : filteredDispensers.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <Zap className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No dispensers found</h3>
            <p className="text-gray-600 mb-4">Get started by creating your first fuel dispenser</p>
            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
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
                  <div key={dispenser.id} className={`bg-white rounded-xl border-2 border-gray-200 shadow hover:shadow-lg transition-shadow ${cardPadding}`}>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center space-x-3">
                        <div className="p-3 bg-green-100 rounded-lg">
                          <Zap className={`${fontSize.icon} text-green-600`} />
                        </div>
                        <div>
                          <h3 className={`font-bold ${fontSize.title} text-gray-900`}>{dispenser.dispenser_name}</h3>
                          <p className={`${fontSize.subtitle} text-gray-500`}>{dispenser.dispenser_code}</p>
                        </div>
                      </div>
                      <span className={`px-2 py-1 rounded-full ${fontSize.label} font-semibold ${
                        dispenser.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {dispenser.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    
                    <div className="space-y-2 mb-4">
                      <div>
                        <p className={`${fontSize.label} text-gray-500 mb-1`}>Island</p>
                        <p className={`${fontSize.subtitle} font-medium text-gray-900`}>{dispenser.island_name || 'N/A'}</p>
                      </div>
                      
                      <div>
                        <p className={`${fontSize.label} text-gray-500 mb-1`}>Station</p>
                        <p className={`${fontSize.subtitle} text-gray-700`}>{dispenser.station_name || 'N/A'}</p>
                      </div>
                      
                      {dispenser.model && (
                        <div>
                          <p className={`${fontSize.label} text-gray-500 mb-1`}>Model</p>
                          <p className={`${fontSize.subtitle} text-gray-700`}>{dispenser.model}</p>
                        </div>
                      )}
                      
                      {dispenser.serial_number && (
                        <div>
                          <p className={`${fontSize.label} text-gray-500 mb-1`}>Serial Number</p>
                          <p className={`${fontSize.subtitle} text-gray-700 font-mono`}>{dispenser.serial_number}</p>
                        </div>
                      )}
                      
                      <div className="flex items-center justify-between pt-2 border-t">
                        <div>
                          <p className={`${fontSize.label} text-gray-500`}>Meters</p>
                          <p className={`${fontSize.value} font-bold text-blue-600`}>{dispenser.meter_count || 0}</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-4 border-t">
                      <button
                        onClick={() => router.push(`/meters?dispenser=${dispenser.id}`)}
                        className={`${fontSize.label} text-blue-600 hover:text-blue-800 font-medium`}
                      >
                        View Meters →
                      </button>
                      <div className="flex items-center space-x-2">
                        <button 
                          onClick={() => handleEdit(dispenser)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                          title="Edit Dispenser"
                        >
                          <Edit className={`${fontSize.icon}`} />
                        </button>
                        <button 
                          onClick={() => {
                            setDeleteId(dispenser.id)
                            setShowDeleteConfirm(true)
                          }}
                          className="p-2 text-red-600 hover:bg-red-50 rounded"
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
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg app-modal-pad max-w-2xl w-full">
              <h2 className="text-2xl font-bold mb-6">{editingId ? 'Edit Dispenser' : 'Add New Dispenser'}</h2>
              <form onSubmit={editingId ? handleUpdate : handleCreate}>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Dispenser Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.dispenser_name}
                      onChange={(e) => setFormData({ ...formData, dispenser_name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g., Pump 1, Dispenser A"
                    />
                  </div>
                  
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Island *
                    </label>
                    <select
                      required
                      value={formData.island_id}
                      onChange={(e) => setFormData({ ...formData, island_id: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
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
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Model
                    </label>
                    <input
                      type="text"
                      value={formData.model}
                      onChange={(e) => setFormData({ ...formData, model: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g., Gilbarco, Wayne"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Manufacturer / brand
                    </label>
                    <input
                      type="text"
                      value={formData.manufacturer}
                      onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g. Gilbarco"
                    />
                  </div>
                  
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Serial Number
                    </label>
                    <input
                      type="text"
                      value={formData.serial_number}
                      onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={formData.is_active}
                        onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-gray-700">Dispenser active</span>
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
                    {editingId ? 'Update Dispenser' : 'Create Dispenser'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg app-modal-pad max-w-md w-full">
              <h2 className="text-2xl font-bold mb-4 text-red-600">Delete Dispenser</h2>
              <p className="text-gray-700 mb-6">
                Are you sure you want to delete this dispenser? This action cannot be undone.
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false)
                    setDeleteId(null)
                  }}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}





