'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { Plus, Edit, Trash2, Search, MapPin } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'

interface Island {
  id: number
  island_code: string
  island_name: string
  station_id: number
  station_name?: string
  location_description: string
  dispenser_count?: number
  is_active: boolean
}

interface Station {
  id: number
  station_number?: string
  station_name: string
}

export default function IslandsPage() {
  const router = useRouter()
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
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto app-scroll-pad">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Islands</h1>
          <p className="text-gray-600 mt-1">Manage pump islands and dispenser locations</p>
        </div>

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
              <input
                type="text"
                placeholder="Search islands..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <select
              value={selectedStation}
              onChange={(e) => setSelectedStation(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Stations</option>
              {stations.map((station) => (
                <option key={station.id} value={station.id}>
                  {station.station_name}
                </option>
              ))}
            </select>
          </div>
          
          <button
            onClick={() => setShowModal(true)}
            className="ml-4 flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="h-5 w-5" />
            <span>Add Island</span>
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : filteredIslands.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <MapPin className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No islands found</h3>
            <p className="text-gray-600 mb-4">Get started by creating your first pump island</p>
            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus className="h-5 w-5" />
              <span>Add Island</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredIslands.map((island) => (
              <div key={island.id} className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    <div className="p-3 bg-purple-100 rounded-lg">
                      <MapPin className="h-6 w-6 text-purple-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-gray-900">{island.island_name}</h3>
                      <p className="text-sm text-gray-500">{island.island_code}</p>
                    </div>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                    island.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {island.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                
                <div className="space-y-2 mb-4">
                  <div>
                    <p className="text-xs text-gray-500 mb-1">Station</p>
                    <p className="text-sm font-medium text-gray-900">{island.station_name || 'N/A'}</p>
                  </div>
                  
                  {island.location_description && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Location</p>
                      <p className="text-sm text-gray-700">{island.location_description}</p>
                    </div>
                  )}
                  
                  <div className="flex items-center justify-between pt-2 border-t">
                    <div>
                      <p className="text-xs text-gray-500">Dispensers</p>
                      <p className="text-lg font-bold text-blue-600">{island.dispenser_count || 0}</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-4 border-t">
                  <button
                    onClick={() => router.push(`/dispensers?island=${island.id}`)}
                    className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                  >
                    View Dispensers →
                  </button>
                  <div className="flex items-center space-x-2">
                    <button 
                      onClick={() => handleEdit(island)}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                      title="Edit Island"
                    >
                      <Edit className="h-4 w-4" />
                    </button>
                    <button 
                      onClick={() => {
                        setDeleteId(island.id)
                        setShowDeleteConfirm(true)
                      }}
                      className="p-2 text-red-600 hover:bg-red-50 rounded"
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

        {/* Create/Edit Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg app-modal-pad max-w-2xl w-full">
              <h2 className="text-2xl font-bold mb-6">{editingId ? 'Edit Island' : 'Add New Island'}</h2>
              <form onSubmit={editingId ? handleUpdate : handleCreate}>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Island Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.island_name}
                      onChange={(e) => setFormData({ ...formData, island_name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g., Island 1, North Island"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Station *
                    </label>
                    <select
                      required
                      value={formData.station_id}
                      onChange={(e) => setFormData({ ...formData, station_id: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value={0}>Select Station</option>
                      {stations.map((station) => (
                        <option key={station.id} value={station.id}>
                          {station.station_name}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Location Description
                    </label>
                    <textarea
                      value={formData.location_description}
                      onChange={(e) => setFormData({ ...formData, location_description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      rows={3}
                      placeholder="e.g., Front entrance, near highway"
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.is_active}
                      onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-gray-700">Island active</span>
                  </label>
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
                    {editingId ? 'Update Island' : 'Create Island'}
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
              <h2 className="text-2xl font-bold mb-4 text-red-600">Delete Island</h2>
              <p className="text-gray-700 mb-6">
                Are you sure you want to delete this island? This action cannot be undone.
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





