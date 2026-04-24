'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { CompanyProvider } from '@/contexts/CompanyContext'
import { Plus, Edit, Trash2, Search, Droplet, AlertTriangle, RefreshCw } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api, { getApiDocsUrl, getBackendOrigin } from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { ReferenceCodePicker } from '@/components/ReferenceCodePicker'

interface Tank {
  id: number
  tank_number: string
  tank_name: string
  station_id: number
  station_name?: string
  product_id: number
  product_name?: string
  capacity: number
  current_stock: number
  reorder_level: number
  unit_of_measure: string
  is_active: boolean
}

interface Station {
  id: number
  station_number?: string
  station_name: string
}

interface Product {
  id: number
  item_number: string
  name: string
  pos_category?: string
  is_active?: boolean
}

export default function TanksPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const apiDocsUrl = getApiDocsUrl()
  const backendOrigin = getBackendOrigin()
  const [tanks, setTanks] = useState<Tank[]>([])
  const [stations, setStations] = useState<Station[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [selectedStation, setSelectedStation] = useState<string>('')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [tankRefCode, setTankRefCode] = useState('')
  const [createCodeNonce, setCreateCodeNonce] = useState(0)
  const [formData, setFormData] = useState({
    tank_name: '',
    station_id: 0,
    product_id: 0,
    capacity: 10000,
    current_stock: 0,
    min_stock_level: 2000,
    is_active: true
  })

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    
    const stationId = searchParams?.get('station')
    if (stationId) {
      setSelectedStation(stationId)
    }
    
    fetchData()
  }, [router, searchParams])


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (formData.station_id === 0 || formData.product_id === 0) {
      toast.error('Please select station and product')
      return
    }
    
    try {
      if (editingId) {
        await api.put(`/tanks/${editingId}/`, formData)
      } else {
        const payload: Record<string, unknown> = { ...formData }
        if (tankRefCode.trim()) payload.tank_number = tankRefCode.trim()
        await api.post('/tanks/', payload)
      }
      toast.success(editingId ? 'Tank updated successfully!' : 'Tank created successfully!')
      setShowModal(false)
      setEditingId(null)
      fetchData()
      resetForm()
    } catch (error) {
      console.error(`Error ${editingId ? 'updating' : 'creating'} tank:`, error)
      const errorMessage = extractErrorMessage(error, `Failed to ${editingId ? 'update' : 'create'} tank`)
      toast.error(errorMessage)
    }
  }

  const handleEdit = (tank: Tank) => {
    setEditingId(tank.id)
    setFormData({
      tank_name: tank.tank_name,
      station_id: tank.station_id,
      product_id: tank.product_id,
      capacity: Number(tank.capacity) || 0,
      current_stock: Number(tank.current_stock) || 0,
      min_stock_level: Number(tank.reorder_level) || 2000,
      is_active: tank.is_active
    })
    setShowModal(true)
  }

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this tank?')) {
      return
    }
    
    try {
      await api.delete(`/tanks/${id}/`)
      toast.success('Tank deleted successfully!')
      fetchData()
    } catch (error) {
      console.error('Error deleting tank:', error)
      const errorMessage = extractErrorMessage(error, 'Failed to delete tank')
      toast.error(errorMessage)
    }
  }

  const resetForm = () => {
    setFormData({
      tank_name: '',
      station_id: 0,
      product_id: 0,
      capacity: 10000,
      current_stock: 0,
      min_stock_level: 2000,
      is_active: true
    })
    setTankRefCode('')
    setEditingId(null)
  }

  const filteredTanks = tanks.filter(tank => {
    const matchesSearch = tank.tank_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         tank.tank_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (tank.product_name && tank.product_name.toLowerCase().includes(searchTerm.toLowerCase()))
    
    const matchesStation = !selectedStation || tank.station_id.toString() === selectedStation
    
    return matchesSearch && matchesStation
  })

  const getFillPercentage = (current: number, capacity: number) => {
    return capacity > 0 ? (current / capacity) * 100 : 0
  }

  const getFillColor = (percentage: number) => {
    if (percentage >= 75) return 'bg-green-500'
    if (percentage >= 50) return 'bg-blue-500'
    if (percentage >= 25) return 'bg-yellow-500'
    return 'bg-red-500'
  }

  const isLowStock = (current: number, reorder: number) => {
    return current <= reorder
  }

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      
      // Check user's company
      try {
        const userStr = localStorage.getItem('user')
        if (userStr) {
          const user = JSON.parse(userStr)
        }
      } catch (e) {
        console.warn('Could not parse user data:', e)
      }
      
      const [tanksRes, stationsRes, productsRes] = await Promise.allSettled([
        api.get('/tanks/'),
        api.get('/stations/'),
        api.get('/items/?for_tanks=1'),
      ])

      if (tanksRes.status === 'fulfilled') {
        const tanksData = tanksRes.value.data
        setTanks(tanksData)
        setError(null)
        
        if (tanksData.length === 0) {
          console.warn('⚠️ No tanks found. This might mean:')
          console.warn('  1. Sample data not initialized')
          console.warn('  2. User logged in with wrong company_id')
          console.warn('  3. Tanks not created for this company')
          console.warn('  Backend is Django; ensure a company exists (python manage.py create_default_company) and add tanks via API or admin.')
        }
      } else {
        console.error('❌ Tanks API error:', tanksRes.reason)
        const errorMessage = extractErrorMessage(tanksRes.reason, 'Failed to load tanks')
        
        // Check if it's a connection error
        const isConnectionError = errorMessage.includes('ERR_CONNECTION_REFUSED') || 
                                  errorMessage.includes('ERR_NETWORK') ||
                                  errorMessage.includes('connection') ||
                                  (tanksRes.reason?.code === 'ECONNREFUSED') ||
                                  (tanksRes.reason?.code === 'ERR_NETWORK')
        
        if (isConnectionError) {
          const connectionError = 'Backend server is not running. Please start it with backend\\run.bat or run: cd backend && python manage.py runserver 8000'
          setError(connectionError)
          toast.error(connectionError)
        } else {
          setError(errorMessage)
          toast.error(errorMessage)
        }
      }
      
      if (stationsRes.status === 'fulfilled') {
        setStations(stationsRes.value.data)
      } else {
        console.error('❌ Stations API error:', stationsRes.reason)
        // Don't show error for stations - it's not critical
      }
      
      if (productsRes.status === 'fulfilled') {
        setProducts(productsRes.value.data as Product[])
      } else {
        console.error('❌ Products API error:', productsRes.reason)
        // Don't show error for products - it's not critical
      }
      
    } catch (error) {
      console.error('❌ Error fetching data:', error)
      const errorMessage = extractErrorMessage(error, 'Error connecting to server')
      setError(errorMessage)
      toast.error(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  return (
    <CompanyProvider>
      <div className="flex h-screen bg-gray-100 page-with-sidebar">
        <Sidebar />
        <div className="flex-1 overflow-auto app-scroll-pad">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Tanks</h1>
          <p className="text-gray-600 mt-1">Manage fuel storage tanks and inventory</p>
        </div>

        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
              <input
                type="text"
                placeholder="Search tanks..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
            type="button"
            onClick={() => {
              resetForm()
              setCreateCodeNonce((n) => n + 1)
              setShowModal(true)
            }}
            className="ml-4 flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-5 w-5" />
            <span>Add Tank</span>
          </button>
        </div>

        {loading ? (
          <div className="space-y-4">
            {/* Loading Skeleton */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="animate-pulse space-y-4">
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 animate-pulse">
                  <div className="h-32 bg-gray-200 rounded"></div>
                </div>
              ))}
            </div>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 sm:p-6 md:p-8">
            <div className="text-center mb-6">
              <AlertTriangle className="h-16 w-16 text-red-600 mx-auto mb-4" />
              <h3 className="text-xl font-bold text-red-800 mb-2">Backend Connection Error</h3>
              <p className="text-red-700 whitespace-pre-line text-left max-w-2xl mx-auto mb-6">{error}</p>
            </div>
            {error.includes('ERR_CONNECTION_REFUSED') || error.includes('ERR_NETWORK') || error.includes('connection') || error.includes('timeout') ? (
              <div className="bg-white border border-red-300 rounded-lg p-6 mb-6 text-left max-w-3xl mx-auto">
                <p className="text-sm font-semibold text-red-800 mb-4">Backend server is not running. To start it:</p>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-medium text-red-700 mb-2">Option 1: Use Start Script (Easiest)</p>
                    <ol className="text-sm text-red-700 list-decimal list-inside space-y-1 ml-2">
                      <li>Go to the project root folder: <code className="bg-red-100 px-1 rounded text-xs">d:\Cursor_Projects\ERP_Filling_Station</code></li>
                      <li>Double-click <code className="bg-red-100 px-2 py-1 rounded font-mono text-xs">backend\run.bat</code> (or run <code className="bg-red-100 px-1 rounded">python manage.py runserver 8000</code> in the backend folder)</li>
                      <li>A command window will open and show server starting</li>
                      <li>Wait until you see: <code className="bg-green-100 px-1 rounded text-xs">Starting development server at {backendOrigin}/</code></li>
                      <li>Come back here and click <strong>"Retry Connection"</strong> button below</li>
                    </ol>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-red-700 mb-2">Option 2: Command Line</p>
                    <div className="bg-gray-100 p-3 rounded font-mono text-xs text-gray-800">
                      cd backend<br />
                      python manage.py runserver 8000
                    </div>
                    <p className="text-xs text-gray-600 mt-1">Or double-click <code>backend\run.bat</code></p>
                  </div>
                  <div className="bg-blue-50 border border-blue-200 rounded p-3">
                    <p className="text-xs text-blue-800">
                      <strong>💡 Tip:</strong> Once started, verify at <a href={apiDocsUrl} target="_blank" rel="noopener noreferrer" className="underline text-blue-600 hover:text-blue-800">{apiDocsUrl}</a> (DEBUG mode)
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
            
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                onClick={fetchData}
                className="inline-flex items-center space-x-2 px-6 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                <RefreshCw className="h-5 w-5" />
                <span>Retry Connection</span>
              </button>
              <a
                href={apiDocsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center space-x-2 px-6 py-3 border border-red-300 text-red-700 rounded-lg hover:bg-red-100 transition-colors font-medium"
              >
                <span>Check Backend Status</span>
              </a>
            </div>
            <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-left max-w-2xl mx-auto">
              <p className="text-sm text-yellow-800 font-semibold mb-2">💡 Troubleshooting Steps:</p>
              <ol className="text-sm text-yellow-700 list-decimal list-inside space-y-1">
                <li>Check if backend is running: Open {apiDocsUrl} (DEBUG mode)</li>
                <li>Check backend console for errors or hanging processes</li>
                <li>Restart the backend server if needed</li>
                <li>Verify database connection in backend logs</li>
              </ol>
            </div>
          </div>
        ) : filteredTanks.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <Droplet className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No tanks found</h3>
            {tanks.length === 0 ? (
              <>
                <p className="text-gray-600 mb-2">No tanks found for your company.</p>
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 text-left max-w-md mx-auto">
                  <p className="text-sm text-blue-800 mb-2">
                    <strong>Possible reasons:</strong>
                  </p>
                  <ul className="text-sm text-blue-700 list-disc list-inside space-y-1">
                    <li>Sample data not initialized for your company</li>
                    <li>You're logged in with a different company</li>
                    <li>Tanks haven't been created yet</li>
                  </ul>
                  <p className="text-sm text-blue-800 mt-3">
                    <strong>Backend is Django.</strong> Ensure a default company exists: <code className="bg-blue-100 px-1 rounded">python manage.py create_default_company</code>. Tanks can be added via the API or Django admin once CRUD is implemented.
                  </p>
                </div>
              </>
            ) : (
              <p className="text-gray-600 mb-4">No tanks match your current search or filter criteria.</p>
            )}
            <button
              type="button"
              onClick={() => {
                resetForm()
                setCreateCodeNonce((n) => n + 1)
                setShowModal(true)
              }}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus className="h-5 w-5" />
              <span>Add Tank</span>
            </button>
          </div>
        ) : (
          (() => {
            // Auto-sizing logic: cards scale based on count
            const tankCount = filteredTanks.length
            let gridCols = 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
            let cardPadding = 'p-6'
            let cardGap = 'gap-6'
            let fontSize = {
              title: 'text-lg',
              subtitle: 'text-sm',
              value: 'text-base',
              label: 'text-xs',
              icon: 'h-6 w-6',
              progressBar: 'h-2.5'
            }
            
            if (tankCount <= 3) {
              gridCols = 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              cardPadding = 'p-4 sm:p-6 md:p-8'
              cardGap = 'gap-6'
              fontSize = {
                title: 'text-2xl',
                subtitle: 'text-base',
                value: 'text-xl',
                label: 'text-sm',
                icon: 'h-8 w-8',
                progressBar: 'h-4'
              }
            } else if (tankCount <= 6) {
              gridCols = 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              cardPadding = 'p-6'
              cardGap = 'gap-6'
              fontSize = {
                title: 'text-xl',
                subtitle: 'text-sm',
                value: 'text-lg',
                label: 'text-xs',
                icon: 'h-6 w-6',
                progressBar: 'h-3'
              }
            } else if (tankCount <= 9) {
              gridCols = 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              cardPadding = 'p-5'
              cardGap = 'gap-5'
              fontSize = {
                title: 'text-lg',
                subtitle: 'text-sm',
                value: 'text-base',
                label: 'text-xs',
                icon: 'h-5 w-5',
                progressBar: 'h-2.5'
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
                progressBar: 'h-2'
              }
            }
            
            return (
              <div className={`grid ${gridCols} ${cardGap} overflow-y-auto max-h-[calc(100vh-250px)] pr-2`}>
                {filteredTanks.map((tank) => {
                  const fillPercentage = getFillPercentage(tank.current_stock, tank.capacity)
                  const lowStock = isLowStock(tank.current_stock, tank.reorder_level)
                  
                  return (
                    <div key={tank.id} className={`bg-white rounded-xl border-2 border-gray-200 shadow hover:shadow-lg transition-shadow ${cardPadding}`}>
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center space-x-3">
                      <div className={`p-3 rounded-lg ${lowStock ? 'bg-red-100' : 'bg-blue-100'}`}>
                        <Droplet className={`${fontSize.icon} ${lowStock ? 'text-red-600' : 'text-blue-600'}`} />
                      </div>
                      <div>
                        <h3 className={`font-bold ${fontSize.title} text-gray-900`}>{tank.tank_name}</h3>
                        <p className={`${fontSize.subtitle} text-gray-500`}>{tank.tank_number}</p>
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded-full ${fontSize.label} font-semibold ${
                      tank.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {tank.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  
                  {lowStock && (
                    <div className={`mb-4 p-2 bg-red-50 border border-red-200 rounded flex items-center space-x-2`}>
                      <AlertTriangle className={`${fontSize.icon} text-red-600`} />
                      <span className={`${fontSize.label} text-red-800 font-medium`}>Low Stock Alert!</span>
                    </div>
                  )}
                  
                  <div className="space-y-3 mb-4">
                    <div>
                      <p className={`${fontSize.label} text-gray-500 mb-1`}>Product</p>
                      <p className={`${fontSize.subtitle} font-medium text-gray-900`}>{tank.product_name || 'N/A'}</p>
                    </div>
                    
                    <div>
                      <p className={`${fontSize.label} text-gray-500 mb-1`}>Station</p>
                      <p className={`${fontSize.subtitle} text-gray-700`}>{tank.station_name || 'N/A'}</p>
                    </div>
                    
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <span className={`${fontSize.label} text-gray-500`}>Current Stock</span>
                        <span className={`${fontSize.value} font-bold text-gray-900`}>
                          {Number(tank.current_stock || 0).toFixed(2)} L
                        </span>
                      </div>
                      
                      {/* Progress Bar */}
                      <div className={`w-full bg-gray-200 rounded-full ${fontSize.progressBar} mb-1`}>
                        <div
                          className={`${fontSize.progressBar} rounded-full transition-all ${getFillColor(fillPercentage)}`}
                          style={{ width: `${Math.min(fillPercentage, 100)}%` }}
                        ></div>
                      </div>
                      
                      <div className={`flex justify-between ${fontSize.label} text-gray-500`}>
                        <span>{fillPercentage.toFixed(1)}% Full</span>
                        <span>Capacity: {Number(tank.capacity || 0).toLocaleString()} L</span>
                      </div>
                    </div>
                    
                    <div className={`flex justify-between ${fontSize.label} pt-2 border-t`}>
                      <span className="text-gray-500">Reorder Level:</span>
                      <span className="font-medium text-gray-700">
                        {Number(tank.reorder_level || 0).toLocaleString()} L
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t">
                    <button
                      onClick={() => router.push(`/tank-dips?tank=${tank.id}`)}
                      className={`${fontSize.label} text-blue-600 hover:text-blue-800 font-medium`}
                    >
                      Record Dip →
                    </button>
                    <div className="flex items-center space-x-2">
                      <button 
                        onClick={() => handleEdit(tank)}
                        className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                        title="Edit Tank"
                      >
                        <Edit className={`${fontSize.icon}`} />
                      </button>
                      <button 
                        onClick={() => handleDelete(tank.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded"
                        title="Delete Tank"
                      >
                        <Trash2 className={`${fontSize.icon}`} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
          )
          })()
        )}

        {/* Create/Edit Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg app-modal-pad max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-2xl font-bold mb-6">
                {editingId ? 'Edit Tank' : 'Add New Tank'}
              </h2>
              <form onSubmit={handleSubmit}>
                {editingId ? (
                  <ReferenceCodePicker
                    kind="tank"
                    id="tank_ref_ro"
                    label="Tank number"
                    value={tanks.find((t) => t.id === editingId)?.tank_number || ''}
                    onChange={() => {}}
                    disabled
                    className="mb-4"
                  />
                ) : (
                  <ReferenceCodePicker
                    key={createCodeNonce}
                    kind="tank"
                    id="tank_ref"
                    label="Tank number"
                    value={tankRefCode}
                    onChange={setTankRefCode}
                    className="mb-4"
                  />
                )}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Tank Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.tank_name}
                      onChange={(e) => setFormData({ ...formData, tank_name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g., Diesel Tank 1"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Station *
                    </label>
                    <select
                      required
                      value={formData.station_id}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10)
                        setFormData({ ...formData, station_id: Number.isFinite(n) ? n : 0 })
                      }}
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
                      Product (Fuel) *
                    </label>
                    <select
                      required
                      value={formData.product_id}
                      onChange={(e) => {
                        const n = parseInt(e.target.value, 10)
                        setFormData({ ...formData, product_id: Number.isFinite(n) ? n : 0 })
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value={0}>Select Product</option>
                      {products.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.name}
                        </option>
                      ))}
                    </select>
                    {!loading && products.length === 0 ? (
                      <p className="mt-2 text-xs text-amber-700">
                        No tank-eligible fuels yet. Add an inventory product with POS category Fuel (covers liquid and
                        gas fuels).
                      </p>
                    ) : null}
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Capacity (Liters) *
                    </label>
                    <input
                      type="number"
                      required
                      min="0"
                      step="0.01"
                      value={Number.isFinite(formData.capacity) ? formData.capacity : ''}
                      onChange={(e) => {
                        const v = e.target.value
                        const n = parseFloat(v)
                        setFormData({
                          ...formData,
                          capacity: v === '' ? 0 : Number.isFinite(n) ? n : formData.capacity,
                        })
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Current Stock (Liters)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={Number.isFinite(formData.current_stock) ? formData.current_stock : ''}
                      onChange={(e) => {
                        const v = e.target.value
                        const n = parseFloat(v)
                        setFormData({
                          ...formData,
                          current_stock: v === '' ? 0 : Number.isFinite(n) ? n : formData.current_stock,
                        })
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Minimum Stock Level (Liters)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={Number.isFinite(formData.min_stock_level) ? formData.min_stock_level : ''}
                      onChange={(e) => {
                        const v = e.target.value
                        const n = parseFloat(v)
                        setFormData({
                          ...formData,
                          min_stock_level: v === '' ? 0 : Number.isFinite(n) ? n : formData.min_stock_level,
                        })
                      }}
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
                      <span className="text-sm font-medium text-gray-700">Tank active</span>
                    </label>
                  </div>
                </div>
                
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 space-y-2">
                  <p className="text-sm text-blue-800">
                    <strong>Note:</strong> Each tank holds one product. The list includes inventory fuels:
                    liquid grades (diesel, petrol, etc.), petroleum gas (LPG/CNG/LNG), and similar—prefer POS
                    category <strong>Fuel</strong> so naming does not matter.
                  </p>
                  <p className="text-sm text-blue-800">
                    Missing a product? In <strong>Products</strong>, use Inventory, set POS category to{' '}
                    <strong>Fuel</strong> (or a category like <em>Petroleum gas</em>), and keep it active.
                  </p>
                </div>
                
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowModal(false)
                      resetForm()
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    {editingId ? 'Update Tank' : 'Add Tank'}
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

