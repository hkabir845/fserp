'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { Plus, Edit, Trash2, Search, Gauge, RotateCcw, Settings } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatDateOnly } from '@/utils/date'

interface Meter {
  id: number
  meter_number: string
  meter_name: string
  dispenser_id: number
  dispenser_name?: string
  island_name?: string
  station_name?: string
  current_reading: number
  last_reset_date: string | null
  reset_count: number
  nozzle_count?: number
  is_active: boolean
}

interface Dispenser {
  id: number
  dispenser_code: string
  dispenser_name: string
  island_name?: string
}

export default function MetersPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const [meters, setMeters] = useState<Meter[]>([])
  const [dispensers, setDispensers] = useState<Dispenser[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [showResetModal, setShowResetModal] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [selectedMeter, setSelectedMeter] = useState<Meter | null>(null)
  const [selectedDispenser, setSelectedDispenser] = useState<string>('')
  const [formData, setFormData] = useState({
    meter_name: '',
    dispenser_id: 0,
    current_reading: 0,
    is_active: true
  })
  const [resetData, setResetData] = useState({
    reason: ''
  })

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    
    const dispenserId = searchParams?.get('dispenser')
    if (dispenserId) {
      setSelectedDispenser(dispenserId)
    }
    
    fetchData()
  }, [router, searchParams])

  const fetchData = async () => {
    try {
      const [metersRes, dispensersRes] = await Promise.allSettled([
        api.get('/meters/'),
        api.get('/dispensers/')
      ])

      if (metersRes.status === 'fulfilled') {
        setMeters(metersRes.value.data)
      } else {
        console.error('❌ Meters API error:', metersRes.reason)
        const errorMessage = extractErrorMessage(metersRes.reason, 'Failed to load meters')
        toast.error(errorMessage)
      }
      
      if (dispensersRes.status === 'fulfilled') {
        setDispensers(dispensersRes.value.data)
      } else {
        console.error('❌ Dispensers API error:', dispensersRes.reason)
        // Don't show error for dispensers - it's not critical
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
    
    if (formData.dispenser_id === 0) {
      toast.error('Please select a dispenser')
      return
    }
    
    try {
      await api.post('/meters/', {
        meter_name: formData.meter_name,
        dispenser_id: formData.dispenser_id,
        current_reading: formData.current_reading,
        is_active: formData.is_active
      })
      toast.success('Meter created successfully!')
      setShowModal(false)
      resetForm()
      fetchData()
    } catch (error) {
      console.error('Error creating meter:', error)
      const errorMessage = extractErrorMessage(error, 'Failed to create meter')
      toast.error(errorMessage)
    }
  }

  const handleEdit = (meter: Meter) => {
    setEditingId(meter.id)
    setFormData({
      meter_name: meter.meter_name,
      dispenser_id: meter.dispenser_id,
      current_reading: Number(meter.current_reading) || 0,
      is_active: meter.is_active
    })
    setShowModal(true)
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId) return
    
    if (formData.dispenser_id === 0) {
      toast.error('Please select a dispenser')
      return
    }
    
    try {
      await api.put(`/meters/${editingId}/`, {
        meter_name: formData.meter_name,
        dispenser_id: formData.dispenser_id,
        current_reading: formData.current_reading,
        is_active: formData.is_active
      })
      toast.success('Meter updated successfully!')
      setShowModal(false)
      resetForm()
      fetchData()
    } catch (error) {
      console.error('Error updating meter:', error)
      const errorMessage = extractErrorMessage(error, 'Failed to update meter')
      toast.error(errorMessage)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    
    try {
      await api.delete(`/meters/${deleteId}/`)
      toast.success('Meter deleted successfully!')
      setShowDeleteConfirm(false)
      setDeleteId(null)
      fetchData()
    } catch (error) {
      console.error('Error deleting meter:', error)
      const errorMessage = extractErrorMessage(error, 'Failed to delete meter')
      toast.error(errorMessage)
    }
  }

  const resetForm = () => {
    setFormData({
      meter_name: '',
      dispenser_id: 0,
      current_reading: 0,
      is_active: true
    })
    setEditingId(null)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    resetForm()
  }

  const handleResetMeter = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!selectedMeter) return
    
    try {
      await api.post(`/meters/${selectedMeter.id}/reset/`, { reason: resetData.reason || '' })
      toast.success('Meter reset successfully!')
      setShowResetModal(false)
      setSelectedMeter(null)
      fetchData()
      setResetData({ reason: '' })
    } catch (error) {
      console.error('Error resetting meter:', error)
      const errorMessage = extractErrorMessage(error, 'Failed to reset meter')
      toast.error(errorMessage)
    }
  }

  const filteredMeters = meters.filter(meter => {
    const matchesSearch = meter.meter_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         String(meter.meter_number || '').toLowerCase().includes(searchTerm.toLowerCase())
    const matchesDispenser = !selectedDispenser || meter.dispenser_id.toString() === selectedDispenser
    return matchesSearch && matchesDispenser
  })

  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto app-scroll-pad">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Meters</h1>
          <p className="text-gray-600 mt-1">Manage fuel meters and readings</p>
        </div>

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
              <input
                type="text"
                placeholder="Search meters..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <select
              value={selectedDispenser}
              onChange={(e) => setSelectedDispenser(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Dispensers</option>
              {dispensers.map((dispenser) => (
                <option key={dispenser.id} value={dispenser.id}>
                  {dispenser.dispenser_name}
                </option>
              ))}
            </select>
          </div>
          
          <button
            onClick={() => setShowModal(true)}
            className="ml-4 flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            <Plus className="h-5 w-5" />
            <span>Add Meter</span>
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : filteredMeters.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <Gauge className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No meters found</h3>
            <p className="text-gray-600 mb-4">Get started by creating your first fuel meter</p>
            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus className="h-5 w-5" />
              <span>Add Meter</span>
            </button>
          </div>
        ) : (
          (() => {
            // Auto-sizing logic: cards scale based on count
            const meterCount = filteredMeters.length
            let gridCols = 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
            let cardPadding = 'p-6'
            let cardGap = 'gap-6'
            let fontSize = {
              title: 'text-lg',
              subtitle: 'text-sm',
              value: 'text-base',
              label: 'text-xs',
              icon: 'h-6 w-6',
              reading: 'text-2xl'
            }
            
            if (meterCount <= 3) {
              gridCols = 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              cardPadding = 'p-4 sm:p-6 md:p-8'
              cardGap = 'gap-6'
              fontSize = {
                title: 'text-2xl',
                subtitle: 'text-base',
                value: 'text-xl',
                label: 'text-sm',
                icon: 'h-8 w-8',
                reading: 'text-3xl'
              }
            } else if (meterCount <= 6) {
              gridCols = 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              cardPadding = 'p-6'
              cardGap = 'gap-6'
              fontSize = {
                title: 'text-xl',
                subtitle: 'text-sm',
                value: 'text-lg',
                label: 'text-xs',
                icon: 'h-6 w-6',
                reading: 'text-2xl'
              }
            } else if (meterCount <= 9) {
              gridCols = 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              cardPadding = 'p-5'
              cardGap = 'gap-5'
              fontSize = {
                title: 'text-lg',
                subtitle: 'text-sm',
                value: 'text-base',
                label: 'text-xs',
                icon: 'h-5 w-5',
                reading: 'text-xl'
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
                icon: 'h-4 w-4',
                reading: 'text-lg'
              }
            }
            
            return (
              <div className={`grid ${gridCols} ${cardGap} overflow-y-auto max-h-[calc(100vh-250px)] pr-2`}>
                {filteredMeters.map((meter) => (
                  <div key={meter.id} className={`bg-white rounded-xl border-2 border-gray-200 shadow hover:shadow-lg transition-shadow ${cardPadding}`}>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center space-x-3">
                        <div className="p-3 bg-indigo-100 rounded-lg">
                          <Gauge className={`${fontSize.icon} text-indigo-600`} />
                        </div>
                        <div>
                          <h3 className={`font-bold ${fontSize.title} text-gray-900`}>{meter.meter_name}</h3>
                          <p className={`${fontSize.subtitle} text-gray-500`}>{meter.meter_number}</p>
                        </div>
                      </div>
                      <span className={`px-2 py-1 rounded-full ${fontSize.label} font-semibold ${
                        meter.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {meter.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    
                    <div className="space-y-3 mb-4">
                      <div>
                        <p className={`${fontSize.label} text-gray-500 mb-1`}>Dispenser</p>
                        <p className={`${fontSize.subtitle} font-medium text-gray-900`}>{meter.dispenser_name || 'N/A'}</p>
                      </div>
                      
                      <div>
                        <p className={`${fontSize.label} text-gray-500 mb-1`}>Island / Station</p>
                        <p className={`${fontSize.subtitle} text-gray-700`}>{meter.island_name} / {meter.station_name}</p>
                      </div>
                      
                      <div className="bg-blue-50 p-3 rounded-lg">
                        <p className={`${fontSize.label} text-gray-600 mb-1`}>Current Reading</p>
                        <p className={`${fontSize.reading} font-bold text-blue-900`}>
                          {Number(meter.current_reading || 0).toLocaleString()} L
                        </p>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2 pt-2 border-t">
                        <div>
                          <p className={`${fontSize.label} text-gray-500`}>Reset Count</p>
                          <p className={`${fontSize.value} font-bold text-gray-700`}>{meter.reset_count || 0}</p>
                        </div>
                        <div>
                          <p className={`${fontSize.label} text-gray-500`}>Nozzles</p>
                          <p className={`${fontSize.value} font-bold text-blue-600`}>{meter.nozzle_count || 0}</p>
                        </div>
                      </div>
                      
                      {meter.last_reset_date && (
                        <div className={fontSize.label + ' text-gray-500'}>
                          Last reset: {formatDateOnly(meter.last_reset_date)}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between pt-4 border-t space-x-2">
                      <button
                        onClick={() => {
                          setSelectedMeter(meter)
                          setShowResetModal(true)
                        }}
                        className={`flex-1 flex items-center justify-center space-x-1 px-3 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 ${fontSize.label}`}
                      >
                        <RotateCcw className={`${fontSize.icon}`} />
                        <span>Reset</span>
                      </button>
                      <button
                        onClick={() => router.push(`/nozzles?meter=${meter.id}`)}
                        className={`flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 ${fontSize.label}`}
                      >
                        Nozzles
                      </button>
                      <button 
                        onClick={() => handleEdit(meter)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                        title="Edit Meter"
                      >
                        <Edit className={`${fontSize.icon}`} />
                      </button>
                      <button 
                        onClick={() => {
                          setDeleteId(meter.id)
                          setShowDeleteConfirm(true)
                        }}
                        className="p-2 text-red-600 hover:bg-red-50 rounded"
                        title="Delete Meter"
                      >
                        <Trash2 className={`${fontSize.icon}`} />
                      </button>
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
              <h2 className="text-2xl font-bold mb-6">{editingId ? 'Edit Meter' : 'Add New Meter'}</h2>
              <form onSubmit={editingId ? handleUpdate : handleCreate}>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Meter Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.meter_name}
                      onChange={(e) => setFormData({ ...formData, meter_name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g., Meter 1, Main Meter"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Dispenser *
                    </label>
                    <select
                      required
                      value={formData.dispenser_id}
                      onChange={(e) => setFormData({ ...formData, dispenser_id: parseInt(e.target.value) })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value={0}>Select Dispenser</option>
                      {dispensers.map((dispenser) => (
                        <option key={dispenser.id} value={dispenser.id}>
                          {dispenser.dispenser_name} ({dispenser.island_name})
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {editingId ? 'Current Reading (Liters)' : 'Initial Reading (Liters)'}
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.current_reading}
                      onChange={(e) => setFormData({ ...formData, current_reading: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="flex items-center gap-2 cursor-pointer mt-6">
                      <input
                        type="checkbox"
                        checked={formData.is_active}
                        onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm font-medium text-gray-700">Meter active</span>
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
                    {editingId ? 'Update Meter' : 'Create Meter'}
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
              <h2 className="text-2xl font-bold mb-4 text-red-600">Delete Meter</h2>
              <p className="text-gray-700 mb-6">
                Are you sure you want to delete this meter? This action cannot be undone.
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

        {/* Reset Modal */}
        {showResetModal && selectedMeter && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg app-modal-pad max-w-md w-full">
              <h2 className="text-2xl font-bold mb-6 text-yellow-600">Reset Meter</h2>
              <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-sm text-yellow-800">
                  <strong>Warning:</strong> Resetting the meter will set the current reading back to zero. This action will be logged for audit purposes.
                </p>
              </div>
              <form onSubmit={handleResetMeter}>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-gray-600 mb-2">Meter: <strong>{selectedMeter.meter_name}</strong></p>
                    <p className="text-sm text-gray-600 mb-2">Current Reading: <strong>{Number(selectedMeter.current_reading).toLocaleString()} L</strong></p>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Reason for reset (optional, for your records)
                    </label>
                    <textarea
                      value={resetData.reason}
                      onChange={(e) => setResetData({ reason: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-yellow-500"
                      rows={3}
                      placeholder="e.g., Maintenance, Calibration, Equipment upgrade"
                    />
                  </div>
                </div>
                
                <div className="flex justify-end space-x-3 mt-6">
                  <button
                    type="button"
                    onClick={() => {
                      setShowResetModal(false)
                      setSelectedMeter(null)
                      setResetData({ reason: '' })
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700"
                  >
                    Reset Meter
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}





