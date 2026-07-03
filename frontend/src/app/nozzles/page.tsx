'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { usePageMeta } from '@/hooks/usePageMeta'
import { Plus, Edit, Trash2, Search, Fuel, Building2, MapPin, Zap, Gauge, Droplet, ArrowRight, X } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { extractErrorMessage } from '@/utils/errorHandler'
import { ReferenceCodePicker } from '@/components/ReferenceCodePicker'
import { filterFuelForecourtStations } from '@/utils/stationCapabilities'

interface Nozzle {
  id: number
  nozzle_number: string
  nozzle_name: string
  meter_id: number
  meter_name?: string
  dispenser_name?: string
  island_name?: string
  station_name?: string
  product_id: number
  product_name?: string
  unit_price?: number
  /** Kept in sync with `is_operational` on save (see API). */
  is_active: boolean
  color_code?: string
  is_operational?: boolean | string
  tank_id?: number
}

/** Source of truth for "active" in the list and POS: operational flag. */
function nozzleIsOperational(n: Pick<Nozzle, 'is_operational'>): boolean {
  const op = n.is_operational
  return op === true || (typeof op === 'string' && (op === 'Y' || op === 'y'))
}

interface Station {
  id: number
  station_number: string
  station_name: string
  operates_fuel_retail?: boolean
}

interface Island {
  id: number
  island_code: string
  island_name: string
  station_id: number
  station_name?: string
}

interface Dispenser {
  id: number
  dispenser_code: string
  dispenser_name: string
  island_id: number
  island_name?: string
}

interface Meter {
  id: number
  meter_number: string
  meter_name: string
  dispenser_id: number
  dispenser_name?: string
  island_name?: string
  station_name?: string
  nozzle_count?: number  // Number of nozzles assigned to this meter (should be 0 or 1)
}

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
}

interface Product {
  id: number
  name: string
  unit_price: number
}

export default function NozzlesPage() {
  const router = useRouter()
  const pageMeta = usePageMeta()
  const searchParams = useSearchParams()
  const toast = useToast()
  
  // Data states
  const [nozzles, setNozzles] = useState<Nozzle[]>([])
  const [stations, setStations] = useState<Station[]>([])
  const [islands, setIslands] = useState<Island[]>([])
  const [dispensers, setDispensers] = useState<Dispenser[]>([])
  const [meters, setMeters] = useState<Meter[]>([])
  const [tanks, setTanks] = useState<Tank[]>([])
  const [products, setProducts] = useState<Product[]>([])
  
  // UI states
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [selectedMeter, setSelectedMeter] = useState<string>('')
  const [currencySymbol, setCurrencySymbol] = useState<string>('৳') // Default to BDT
  
  // Cascading selection states
  const [selectedStation, setSelectedStation] = useState<number | null>(null)
  const [selectedIsland, setSelectedIsland] = useState<number | null>(null)
  const [selectedDispenser, setSelectedDispenser] = useState<number | null>(null)
  const [selectedMeterId, setSelectedMeterId] = useState<number | null>(null)
  const [selectedTank, setSelectedTank] = useState<number | null>(null)
  const [nozzleRefCode, setNozzleRefCode] = useState('')
  const [createCodeNonce, setCreateCodeNonce] = useState(0)

  const fuelForecourtStations = useMemo(() => filterFuelForecourtStations(stations), [stations])

  useEffect(() => {
    if (selectedStation == null) return
    if (!fuelForecourtStations.some((s) => s.id === selectedStation)) {
      setSelectedStation(null)
      setSelectedIsland(null)
      setSelectedDispenser(null)
      setSelectedMeterId(null)
      setSelectedTank(null)
    }
  }, [fuelForecourtStations, selectedStation])
  
  // Form data
  const [formData, setFormData] = useState({
    nozzle_name: '',
    meter_id: 0,
    tank_id: 0,
    color_code: '#3B82F6',
    is_operational: true
  })

  // Auto-generate nozzle name based on selections
  const generateNozzleName = (meterId: number | null, tankId: number | null): string => {
    if (!meterId || !tankId) {
      return ''
    }
    
    const meter = meters.find(m => m.id === meterId)
    const tank = tanks.find(t => t.id === tankId)
    
    if (meter && tank) {
      return `${meter.meter_name} - ${tank.product_name}`
    }
    
    return ''
  }

  // Update nozzle name when meter or tank changes
  useEffect(() => {
    if (selectedMeterId && selectedTank) {
      const generatedName = generateNozzleName(selectedMeterId, selectedTank)
      if (generatedName) {
        setFormData(prev => ({ ...prev, nozzle_name: generatedName }))
      }
    }
  }, [selectedMeterId, selectedTank, meters, tanks])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    
    const meterId = searchParams?.get('meter')
    if (meterId) {
      setSelectedMeter(meterId)
    }
    
    fetchAllData()
  }, [router, searchParams])

  // Fetch all data on mount
  const fetchAllData = async () => {
    try {
      // Fetch company currency
      try {
        const companyRes = await api.get('/companies/current')
        if (companyRes.data?.currency) {
          setCurrencySymbol(getCurrencySymbol(companyRes.data.currency))
        }
      } catch (error) {
        console.error('Error fetching company currency:', error)
      }

      const [nozzlesRes, stationsRes, islandsRes, dispensersRes, metersRes, tanksRes, productsRes] = await Promise.allSettled([
        api.get('/nozzles/'),
        api.get('/stations/'),
        api.get('/islands/'),
        api.get('/dispensers/'),
        api.get('/meters/'),
        api.get('/tanks/'),
        api.get('/items/?for_tanks=1'),
      ])

      if (nozzlesRes.status === 'fulfilled') {
        setNozzles(nozzlesRes.value.data)
      } else {
        console.error('❌ Nozzles API error:', nozzlesRes.reason)
        const errorMessage = extractErrorMessage(nozzlesRes.reason, 'Failed to load nozzles')
        toast.error(errorMessage)
      }
      
      if (stationsRes.status === 'fulfilled') {
        setStations(stationsRes.value.data)
      }
      
      if (islandsRes.status === 'fulfilled') {
        setIslands(islandsRes.value.data)
      }
      
      if (dispensersRes.status === 'fulfilled') {
        setDispensers(dispensersRes.value.data)
      }
      
      if (metersRes.status === 'fulfilled') {
        setMeters(metersRes.value.data)
      }
      
      if (tanksRes.status === 'fulfilled') {
        setTanks(tanksRes.value.data)
      }
      
      if (productsRes.status === 'fulfilled') {
        setProducts(productsRes.value.data)
      }
      
    } catch (error) {
      console.error('❌ Error fetching data:', error)
      const errorMessage = extractErrorMessage(error, 'Error loading data')
      toast.error(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  // Helper functions to determine availability/selectability while still displaying full lists
  const isIslandSelectable = (island: Island): boolean => {
    if (!selectedStation) return false
    return island.station_id === selectedStation
  }

  const isDispenserSelectable = (dispenser: Dispenser): boolean => {
    if (!selectedIsland) return false
    return dispenser.island_id === selectedIsland
  }

  const isMeterInSelectedDispenser = (meter: Meter): boolean => {
    if (!selectedDispenser) return false
    return meter.dispenser_id === selectedDispenser
  }

  const isMeterAvailable = (meter: Meter): boolean => {
    if (!isMeterInSelectedDispenser(meter)) return false
    if (editingId && selectedMeterId && meter.id === selectedMeterId) return true // Current meter when editing
    return (meter.nozzle_count || 0) === 0 // No nozzle assigned yet
  }

  const isTankSelectable = (tank: Tank): boolean => {
    if (!selectedStation) return false
    return tank.station_id === selectedStation
  }

  // Handle cascading selections
  const handleStationChange = (stationId: number | null) => {
    setSelectedStation(stationId)
    setSelectedIsland(null)
    setSelectedDispenser(null)
    setSelectedMeterId(null)
    setSelectedTank(null)
  }

  const handleIslandChange = (islandId: number | null) => {
    setSelectedIsland(islandId)
    setSelectedDispenser(null)
    setSelectedMeterId(null)
  }

  const handleDispenserChange = (dispenserId: number | null) => {
    setSelectedDispenser(dispenserId)
    setSelectedMeterId(null)
  }

  const handleMeterChange = (meterId: number | null) => {
    setSelectedMeterId(meterId)
    setFormData(prev => ({ 
      ...prev, 
      meter_id: meterId || 0
    }))
  }

  const handleTankChange = (tankId: number | null) => {
    setSelectedTank(tankId)
    setFormData(prev => ({ 
      ...prev, 
      tank_id: tankId || 0
    }))
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.meter_id || formData.meter_id === 0) {
      toast.error('Please select a meter')
      return
    }
    
    if (!formData.tank_id || formData.tank_id === 0) {
      toast.error('Please select a tank')
      return
    }
    
    // Auto-generate nozzle name from current selections
    const nozzleName = generateNozzleName(selectedMeterId, selectedTank)
    if (!nozzleName) {
      toast.error('Unable to generate nozzle name. Please ensure meter and tank are selected.')
      return
    }
    
    try {
      const payload: Record<string, unknown> = {
        nozzle_name: nozzleName,
        meter_id: formData.meter_id,
        tank_id: formData.tank_id,
        color_code: formData.color_code,
        is_operational: formData.is_operational,
        is_active: formData.is_operational
      }
      if (nozzleRefCode.trim()) {
        payload.nozzle_number = nozzleRefCode.trim()
      }
      await api.post('/nozzles/', payload)
      toast.success('Nozzle created successfully!')
      setShowModal(false)
      resetForm()
      fetchAllData()
    } catch (error) {
      console.error('Error creating nozzle:', error)
      toast.error(extractErrorMessage(error, 'Failed to create nozzle'))
    }
  }

  const handleEdit = (nozzle: Nozzle) => {
    setEditingId(nozzle.id)
    
    // Find the station from the nozzle's hierarchy
    const meter = meters.find(m => m.id === nozzle.meter_id)
    if (meter) {
      const dispenser = dispensers.find(d => d.id === meter.dispenser_id)
      if (dispenser) {
        const island = islands.find(i => i.id === dispenser.island_id)
        if (island) {
          setSelectedStation(island.station_id)
          setSelectedIsland(island.id)
          setSelectedDispenser(dispenser.id)
          setSelectedMeterId(meter.id)
        }
      }
    }
    
    if (nozzle.tank_id) {
      const tank = tanks.find(t => t.id === nozzle.tank_id)
      if (tank) {
        if (!selectedStation) {
          setSelectedStation(tank.station_id)
        }
        setSelectedTank(tank.id)
      }
    }
    
    const op = nozzle.is_operational
    setFormData({
      nozzle_name: nozzle.nozzle_name,
      meter_id: nozzle.meter_id,
      tank_id: nozzle.tank_id || 0,
      color_code: nozzle.color_code || '#3B82F6',
      is_operational:
        op === true ||
        (typeof op === 'string' && (op === 'Y' || op === 'y'))
    })
    setShowModal(true)
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingId) return
    
    // Auto-generate nozzle name from current selections (or keep existing if editing and selections unchanged)
    const nozzleName = generateNozzleName(selectedMeterId, selectedTank) || formData.nozzle_name
    if (!nozzleName) {
      toast.error('Unable to generate nozzle name. Please ensure meter and tank are selected.')
      return
    }
    
    try {
      await api.put(`/nozzles/${editingId}/`, {
        nozzle_name: nozzleName,
        color_code: formData.color_code,
        is_operational: formData.is_operational,
        is_active: formData.is_operational,
        tank_id: formData.tank_id || null,
        meter_id: formData.meter_id || null
      })
      toast.success('Nozzle updated successfully!')
      setShowModal(false)
      resetForm()
      fetchAllData()
    } catch (error) {
      console.error('Error updating nozzle:', error)
      const errorMessage = extractErrorMessage(error, 'Failed to update nozzle')
      toast.error(errorMessage)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    
    try {
      await api.delete(`/nozzles/${deleteId}/`)
      toast.success('Nozzle deleted successfully!')
      setShowDeleteConfirm(false)
      setDeleteId(null)
      fetchAllData()
    } catch (error) {
      console.error('Error deleting nozzle:', error)
      const errorMessage = extractErrorMessage(error, 'Failed to delete nozzle')
      toast.error(errorMessage)
    }
  }

  const resetForm = () => {
    setFormData({
      nozzle_name: '',
      meter_id: 0,
      tank_id: 0,
      color_code: '#3B82F6',
      is_operational: true
    })
    setNozzleRefCode('')
    setEditingId(null)
    setSelectedStation(null)
    setSelectedIsland(null)
    setSelectedDispenser(null)
    setSelectedMeterId(null)
    setSelectedTank(null)
  }

  const handleCloseModal = () => {
    setShowModal(false)
    resetForm()
  }

  const filteredNozzles = nozzles.filter(nozzle => {
    const matchesSearch = nozzle.nozzle_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         String(nozzle.nozzle_number || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (nozzle.product_name && nozzle.product_name.toLowerCase().includes(searchTerm.toLowerCase()))
    const matchesMeter = !selectedMeter || nozzle.meter_id.toString() === selectedMeter
    return matchesSearch && matchesMeter
  })

  return (
    <PageLayout>
      <ErpPageShell
        showBackLink={false}
        title={pageMeta.title}
        titleIcon={Fuel}
        description={pageMeta.description}
        maxWidthClass="max-w-[1600px]"
        contentClassName="mt-4"
        actions={
          <button
            type="button"
            onClick={() => {
              resetForm()
              setCreateCodeNonce((n) => n + 1)
              setShowModal(true)
            }}
            className="erp-btn-cta"
          >
            <Plus className="h-5 w-5" />
            <span>Add Nozzle</span>
          </button>
        }
      >
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4 flex-1">
            <div className="relative flex-1 max-w-md">
              <Search className="erp-search-icon" />
              <input
                type="text"
                placeholder="Search nozzles..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="erp-field pl-10"
              />
            </div>
            
            <select
              value={selectedMeter}
              onChange={(e) => setSelectedMeter(e.target.value)}
              className="erp-field w-auto min-w-[12rem]"
            >
              <option value="">All Meters</option>
              {meters.map((meter) => (
                <option key={meter.id} value={meter.id}>
                  {meter.meter_name} ({meter.dispenser_name})
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="erp-loading-spinner h-12 w-12"></div>
          </div>
        ) : filteredNozzles.length === 0 ? (
          <div className="erp-empty-state">
            <Fuel className="h-16 w-16 text-muted-foreground/40 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">No nozzles found</h3>
            <p className="text-muted-foreground mb-4">Get started by creating your first fuel nozzle</p>
            <button
              type="button"
              onClick={() => {
                resetForm()
                setCreateCodeNonce((n) => n + 1)
                setShowModal(true)
              }}
              className="erp-btn-cta"
            >
              <Plus className="h-5 w-5" />
              <span>Add Nozzle</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {filteredNozzles.map((nozzle) => (
              <div key={nozzle.id} className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center space-x-2">
                    <div className={`p-2 rounded-lg ${
                      nozzle.product_name?.toLowerCase().includes('diesel') ? 'bg-yellow-100' :
                      nozzle.product_name?.toLowerCase().includes('petrol') ? 'bg-destructive/10' :
                      'bg-blue-100'
                    }`}>
                      <Fuel className={`h-5 w-5 ${
                        nozzle.product_name?.toLowerCase().includes('diesel') ? 'text-yellow-600' :
                        nozzle.product_name?.toLowerCase().includes('petrol') ? 'text-destructive' :
                        'text-primary'
                      }`} />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-foreground">{nozzle.nozzle_name}</h3>
                      <p className="text-xs text-muted-foreground">{nozzle.nozzle_number}</p>
                    </div>
                  </div>
                  <span className={`erp-badge ${nozzleIsOperational(nozzle) ? 'erp-badge--success' : 'erp-badge--danger'}`}>
                    {nozzleIsOperational(nozzle) ? 'Active' : 'Off'}
                  </span>
                </div>
                
                <div className="space-y-2 mb-3">
                  <div className={`p-2 rounded-lg text-center ${
                    nozzle.product_name?.toLowerCase().includes('diesel') ? 'bg-yellow-50 border border-yellow-200' :
                    nozzle.product_name?.toLowerCase().includes('petrol') ? 'bg-destructive/5 border border-destructive/25' :
                    'bg-blue-50 border border-primary/25'
                  }`}>
                    <p className="text-xs text-muted-foreground">Product</p>
                    <p className={`font-bold text-sm ${
                      nozzle.product_name?.toLowerCase().includes('diesel') ? 'text-yellow-800' :
                      nozzle.product_name?.toLowerCase().includes('petrol') ? 'text-destructive' :
                      'text-primary'
                    }`}>
                      {nozzle.product_name || 'N/A'}
                    </p>
                    {nozzle.unit_price && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {currencySymbol}{formatNumber(Number(nozzle.unit_price))}/L
                      </p>
                    )}
                  </div>
                  
                  <div className="text-xs space-y-1">
                    <p className="text-muted-foreground">
                      <span className="font-medium">Meter:</span> {nozzle.meter_name}
                    </p>
                    <p className="text-muted-foreground">
                      <span className="font-medium">Dispenser:</span> {nozzle.dispenser_name}
                    </p>
                    <p className="text-muted-foreground">
                      <span className="font-medium">Station:</span> {nozzle.station_name}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 border-t">
                  <button
                    onClick={() => router.push(`/cashier?nozzle=${nozzle.id}`)}
                    className="erp-link mr-2 flex-1 text-xs"
                  >
                    Use in POS →
                  </button>
                  <div className="flex items-center space-x-1">
                    <button 
                      onClick={() => handleEdit(nozzle)}
                      className="erp-icon-btn-primary p-1.5"
                      title="Edit Nozzle"
                    >
                      <Edit className="h-3 w-3" />
                    </button>
                    <button 
                      onClick={() => {
                        setDeleteId(nozzle.id)
                        setShowDeleteConfirm(true)
                      }}
                      className="p-1.5 text-destructive hover:bg-destructive/5 rounded"
                      title="Delete Nozzle"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create/Edit Modal with Cascading Dropdowns */}
        {showModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
            <div className="bg-white rounded-lg app-modal-pad max-w-[1440px] w-full my-8 max-h-[96vh] overflow-y-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold">{editingId ? 'Edit Nozzle' : 'Configure Nozzle'}</h2>
                <button
                  onClick={handleCloseModal}
                  className="text-muted-foreground/70 hover:text-muted-foreground"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
              
              <form onSubmit={editingId ? handleUpdate : handleCreate}>
                {/* Hierarchy Selection Section */}
                <div className="erp-callout-primary mb-6 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center">
                    <Building2 className="h-5 w-5 mr-2 text-primary" />
                    Select Station Hierarchy
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Station */}
                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">
                        Station *
                      </label>
                      <select
                        required
                        value={selectedStation || ''}
                        onChange={(e) => handleStationChange(e.target.value ? parseInt(e.target.value) : null)}
                        className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring bg-white"
                      >
                        <option value="">Select Station</option>
                        {fuelForecourtStations.map((station) => (
                          <option 
                            key={station.id} 
                            value={station.id}
                            style={{ color: '#000', backgroundColor: '#fff' }}
                          >
                            {station.station_name} {station.station_number ? `(${station.station_number})` : ''}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {fuelForecourtStations.length} fuel forecourt site(s) — shop/aquaculture-only stations are hidden
                      </p>
                    </div>

                    {/* Island */}
                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">
                        Island *
                      </label>
                      <select
                        required
                        value={selectedIsland || ''}
                        onChange={(e) => {
                          const islandId = e.target.value ? parseInt(e.target.value) : null
                          if (islandId) {
                            const island = islands.find(i => i.id === islandId)
                            if (island && isIslandSelectable(island)) {
                              handleIslandChange(islandId)
                            }
                          } else {
                            handleIslandChange(null)
                          }
                        }}
                        disabled={!selectedStation}
                        className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring bg-white disabled:bg-muted disabled:cursor-not-allowed"
                      >
                        <option value="">
                          {!selectedStation ? 'Select Station first' : islands.length === 0 ? 'No islands available' : 'Select Island'}
                        </option>
                        {islands.map((island) => {
                          const selectable = isIslandSelectable(island)
                          return (
                            <option 
                              key={island.id} 
                              value={island.id}
                              disabled={!selectable}
                              className={selectable ? 'text-foreground bg-white' : 'text-muted-foreground/70 bg-muted'}
                            >
                              {island.island_name} {island.island_code ? `(${island.island_code})` : ''}
                              {!selectable ? ' ❌ [Different Station]' : ' ✓ [Available]'}
                            </option>
                          )
                        })}
                      </select>
                      {selectedStation && (
                        <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                          <p>
                            {islands.filter(isIslandSelectable).length} island(s) available for this station
                          </p>
                          <p className="text-muted-foreground/70">
                            {islands.filter(island => !isIslandSelectable(island)).length} island(s) belong to other stations
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Dispenser */}
                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">
                        Dispenser *
                      </label>
                      <select
                        required
                        value={selectedDispenser || ''}
                        onChange={(e) => {
                          const dispenserId = e.target.value ? parseInt(e.target.value) : null
                          if (dispenserId) {
                            const dispenser = dispensers.find(d => d.id === dispenserId)
                            if (dispenser && isDispenserSelectable(dispenser)) {
                              handleDispenserChange(dispenserId)
                            }
                          } else {
                            handleDispenserChange(null)
                          }
                        }}
                        disabled={!selectedIsland}
                        className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring bg-white disabled:bg-muted disabled:cursor-not-allowed"
                      >
                        <option value="">
                          {!selectedIsland ? 'Select Island first' : dispensers.length === 0 ? 'No dispensers available' : 'Select Dispenser'}
                        </option>
                        {dispensers.map((dispenser) => {
                          const selectable = isDispenserSelectable(dispenser)
                          return (
                            <option 
                              key={dispenser.id} 
                              value={dispenser.id}
                              disabled={!selectable}
                              className={selectable ? 'text-foreground bg-white' : 'text-muted-foreground/70 bg-muted'}
                            >
                              {dispenser.dispenser_name} {dispenser.dispenser_code ? `(${dispenser.dispenser_code})` : ''}
                              {!selectable ? ' ❌ [Different Island]' : ' ✓ [Available]'}
                            </option>
                          )
                        })}
                      </select>
                      {selectedIsland && (
                        <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                          <p>
                            {dispensers.filter(isDispenserSelectable).length} dispenser(s) available for this island
                          </p>
                          <p className="text-muted-foreground/70">
                            {dispensers.filter(dispenser => !isDispenserSelectable(dispenser)).length} dispenser(s) belong to other islands
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Meter */}
                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">
                        Meter * <span className="text-xs text-muted-foreground">(1 Meter = 1 Nozzle)</span>
                      </label>
                      <select
                        required
                        value={selectedMeterId || ''}
                        onChange={(e) => {
                          const meterId = e.target.value ? parseInt(e.target.value) : null
                          if (meterId) {
                            const meter = meters.find(m => m.id === meterId)
                            if (meter && isMeterAvailable(meter)) {
                              handleMeterChange(meterId)
                            }
                          } else {
                            handleMeterChange(null)
                          }
                        }}
                        disabled={!selectedDispenser}
                        className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring bg-white disabled:bg-muted disabled:cursor-not-allowed"
                      >
                        <option value="">
                          {!selectedDispenser ? 'Select Dispenser first' : meters.length === 0 ? 'No meters available' : 'Select Meter'}
                        </option>
                        {meters.map((meter) => {
                          const inSelectedDispenser = isMeterInSelectedDispenser(meter)
                          const available = isMeterAvailable(meter)
                          const isCurrent = editingId && selectedMeterId === meter.id
                          const isDisabled = !inSelectedDispenser || (!available && !isCurrent)
                          return (
                            <option 
                              key={meter.id} 
                              value={meter.id}
                              disabled={isDisabled}
                              className={isDisabled ? 'text-muted-foreground/70 bg-muted' : 'text-foreground bg-white'}
                            >
                              {meter.meter_name} {meter.meter_number ? `(${meter.meter_number})` : ''}
                              {!inSelectedDispenser ? ' ❌ [Different Dispenser]' : ''}
                              {inSelectedDispenser && !available && !isCurrent ? ' ❌ [Already Configured - Not Selectable]' : ''}
                              {isCurrent ? ' ✓ [Current]' : ''}
                              {inSelectedDispenser && available && !isCurrent ? ' ✓ [Available]' : ''}
                            </option>
                          )
                        })}
                      </select>
                      {selectedDispenser && (
                        <div className="mt-2 space-y-1">
                          {meters.filter(m => isMeterAvailable(m)).length > 0 && (
                            <p className="text-xs text-success">
                              ✓ {meters.filter(m => isMeterAvailable(m)).length} available meter(s)
                            </p>
                          )}
                          {meters.filter(m => isMeterInSelectedDispenser(m) && !isMeterAvailable(m)).length > 0 && (
                            <p className="text-xs text-muted-foreground">
                              {meters.filter(m => isMeterInSelectedDispenser(m) && !isMeterAvailable(m)).length} meter(s) already configured for this dispenser
                            </p>
                          )}
                          {meters.filter(m => !isMeterInSelectedDispenser(m)).length > 0 && (
                            <p className="text-xs text-muted-foreground/70">
                              {meters.filter(m => !isMeterInSelectedDispenser(m)).length} meter(s) belong to other dispensers
                            </p>
                          )}
                          <p className="text-xs text-muted-foreground">
                            Each meter is dedicated to one nozzle (1:1 relationship)
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Visual Hierarchy Flow */}
                  {selectedStation && (
                    <div className="mt-4 bg-white rounded-lg p-3 border border-border">
                      <div className="flex items-center justify-center space-x-2 text-sm text-muted-foreground mb-2">
                        <Building2 className="h-4 w-4 text-primary" />
                        <span className="font-medium">{stations.find(s => s.id === selectedStation)?.station_name}</span>
                        {selectedIsland && (
                          <>
                            <ArrowRight className="h-4 w-4 text-muted-foreground/70" />
                            <MapPin className="h-4 w-4 text-primary" />
                            <span className="font-medium">{islands.find(i => i.id === selectedIsland)?.island_name}</span>
                          </>
                        )}
                        {selectedDispenser && (
                          <>
                            <ArrowRight className="h-4 w-4 text-muted-foreground/70" />
                            <Zap className="h-4 w-4 text-yellow-600" />
                            <span className="font-medium">{dispensers.find(d => d.id === selectedDispenser)?.dispenser_name}</span>
                          </>
                        )}
                        {selectedMeterId && (
                          <>
                            <ArrowRight className="h-4 w-4 text-muted-foreground/70" />
                            <Gauge className="h-4 w-4 text-success" />
                            <span className="font-medium">{meters.find(m => m.id === selectedMeterId)?.meter_name}</span>
                            <span className="text-xs text-muted-foreground">
                              ({meters.find(m => m.id === selectedMeterId)?.meter_number})
                            </span>
                          </>
                        )}
                      </div>
                      {selectedMeterId && (
                        <div className="text-xs text-center text-muted-foreground border-t pt-2 mt-2">
                          <p>📌 This meter will be dedicated to one nozzle (1:1 relationship)</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Tank & Product Selection */}
                <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-6 mb-6 border border-success/25">
                  <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center">
                    <Droplet className="h-5 w-5 mr-2 text-success" />
                    Select Tank & Product
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Tank */}
                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">
                        Tank *
                      </label>
                      <select
                        required
                        value={selectedTank || ''}
                        onChange={(e) => handleTankChange(e.target.value ? parseInt(e.target.value) : null)}
                        disabled={!selectedStation}
                        className="w-full px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-success bg-white disabled:bg-muted disabled:cursor-not-allowed"
                      >
                        <option value="">
                          {!selectedStation ? 'Select Station first' : tanks.length === 0 ? 'No tanks available' : 'Select Tank'}
                        </option>
                        {tanks.map((tank) => {
                          const selectable = isTankSelectable(tank)
                          return (
                            <option 
                              key={tank.id} 
                              value={tank.id}
                              disabled={!selectable}
                              className={selectable ? 'text-foreground bg-white' : 'text-muted-foreground/70 bg-muted'}
                            >
                              {tank.tank_name} - {tank.product_name} ({formatNumber(Number(tank.current_stock || 0), 2)}L / {formatNumber(Number(tank.capacity || 0), 2)}L)
                              {selectable ? ' ✓ [Available]' : ' ❌ [Different Station]'}
                            </option>
                          )
                        })}
                      </select>
                      {selectedStation && (
                        <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                          <p>
                            {tanks.filter(isTankSelectable).length} tank(s) available for this station - Multiple nozzles can share the same tank
                          </p>
                          <p className="text-muted-foreground/70">
                            {tanks.filter(tank => !isTankSelectable(tank)).length} tank(s) belong to other stations
                          </p>
                        </div>
                      )}
                      {selectedTank && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          {(() => {
                            const selectedTankData = tanks.find(t => t.id === selectedTank)
                            if (!selectedTankData) return null
                            return (
                              <>
                                <p>Product: <span className="font-medium">{selectedTankData.product_name}</span></p>
                                <p>Stock: <span className="font-medium">{formatNumber(Number(selectedTankData.current_stock || 0), 2)}L</span> / <span className="font-medium">{formatNumber(Number(selectedTankData.capacity || 0), 2)}L</span></p>
                              </>
                            )
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Nozzle Details */}
                <div className="space-y-4 mb-6">
                  <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center">
                    <Fuel className="h-5 w-5 mr-2 text-primary" />
                    Nozzle Details
                  </h3>

                  {editingId ? (
                    <ReferenceCodePicker
                      kind="nozzle"
                      id="nozzle_ref_code_ro"
                      label="Nozzle number"
                      value={nozzles.find((n) => n.id === editingId)?.nozzle_number || ''}
                      onChange={() => {}}
                      disabled
                    />
                  ) : (
                    <ReferenceCodePicker
                      key={createCodeNonce}
                      kind="nozzle"
                      id="nozzle_ref_code"
                      label="Nozzle number"
                      value={nozzleRefCode}
                      onChange={setNozzleRefCode}
                    />
                  )}
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Auto-generated Nozzle Name Preview */}
                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">
                        Nozzle Name (Auto-generated) *
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={generateNozzleName(selectedMeterId, selectedTank) || 'Select meter and tank to generate name'}
                          disabled
                          readOnly
                          className="w-full px-3 py-2 border border-border rounded-lg bg-muted/40 text-foreground/85 cursor-not-allowed"
                        />
                        {selectedMeterId && selectedTank && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <span className="text-success text-xs font-medium">✓ Auto-generated</span>
                          </div>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Name format: [Meter Name] - [Product Name]
                      </p>
                    </div>

                    <div>
                      <label className="mb-2 block text-sm font-medium text-foreground">
                        Color Code
                      </label>
                      <div className="flex items-center space-x-2">
                        <input
                          type="color"
                          value={formData.color_code}
                          onChange={(e) => setFormData({ ...formData, color_code: e.target.value })}
                          className="h-10 w-20 border border-border rounded-lg cursor-pointer"
                        />
                        <input
                          type="text"
                          value={formData.color_code}
                          onChange={(e) => setFormData({ ...formData, color_code: e.target.value })}
                          className="flex-1 px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-ring"
                          placeholder="#3B82F6"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={formData.is_operational}
                          onChange={(e) => setFormData({ ...formData, is_operational: e.target.checked })}
                          className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
                        />
                        <span className="text-sm font-medium text-foreground/85">Operational (Active for POS)</span>
                      </label>
                    </div>
                  </div>
                </div>

                {/* Info Box */}
                <div className="bg-blue-50 border border-primary/25 rounded-lg p-4 mb-6">
                  <div className="space-y-2 text-sm text-primary">
                    <p>
                      <strong>📋 Hierarchy Relationship:</strong>
                    </p>
                    <ul className="list-disc list-inside space-y-1 ml-2">
                      <li>1 Island → Multiple Dispensers</li>
                      <li>1 Dispenser → Multiple Meters</li>
                      <li>1 Meter → 1 Nozzle (1:1 relationship)</li>
                      <li>Multiple Nozzles can share the same Tank</li>
                    </ul>
                    <p className="mt-2">
                      <strong>Note:</strong> The nozzle name is automatically generated from the selected meter and product. Each meter is dedicated to one nozzle only. The product and price are determined by the selected tank.
                    </p>
                  </div>
                </div>
                
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="px-6 py-2 border border-border rounded-lg hover:bg-muted/40 font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="erp-btn-primary px-6 py-2 font-medium"
                  >
                    {editingId ? 'Update Nozzle' : 'Create Nozzle'}
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
              <h2 className="mb-4 text-2xl font-bold text-destructive">Delete Nozzle</h2>
              <p className="mb-6 text-foreground/85">
                Are you sure you want to delete this nozzle? This action cannot be undone.
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





