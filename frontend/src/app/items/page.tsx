'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { Plus, Edit, Trash2, Search, Package, Box, Wrench, Camera, X, Grid3x3, List } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api, { getApiBaseUrl, getBackendOrigin } from '@/lib/api'
import { getCurrencySymbol } from '@/utils/currency'
import { extractErrorMessage } from '@/utils/errorHandler'

/** API returns decimals as strings; tanks-backed quantity is merged server-side. */
function parseInventoryQty(raw: unknown): number {
  if (raw == null) return 0
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  const n = parseFloat(String(raw).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

interface ProductTankRow {
  id: number
  tank_name: string
}

interface Item {
  id: number
  item_number: string
  name: string
  description?: string
  item_type: 'inventory' | 'non_inventory' | 'service' | 'INVENTORY' | 'NON_INVENTORY' | 'SERVICE'
  unit_price: number
  cost: number
  quantity_on_hand: number | string
  unit: string
  is_active: boolean
  pos_category?: string
  is_pos_available?: boolean
  is_taxable?: boolean
  barcode?: string
  category?: string
  image_url?: string
}

export default function ItemsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [filterType, setFilterType] = useState<string>('ALL')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [currencySymbol, setCurrencySymbol] = useState<string>('৳') // Default to BDT
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    item_type: 'inventory' as 'inventory' | 'non_inventory' | 'service',
    unit_price: 0,
    cost: 0,
    quantity_on_hand: 0,
    unit: 'piece',
    pos_category: 'general',
    is_pos_available: true,
    is_taxable: true,
    is_active: true,
    barcode: '',
    category: '',
    image_url: ''
  })
  const [fuelTanksForProduct, setFuelTanksForProduct] = useState<ProductTankRow[]>([])
  const [selectedFuelTankId, setSelectedFuelTankId] = useState<number | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [cameraVideoRef, setCameraVideoRef] = useState<HTMLVideoElement | null>(null)
  const [viewMode, setViewMode] = useState<'card' | 'list'>(() => {
    // Load view mode from localStorage if available
    if (typeof window !== 'undefined') {
      const savedViewMode = localStorage.getItem('items_view_mode')
      if (savedViewMode === 'card' || savedViewMode === 'list') {
        return savedViewMode as 'card' | 'list'
      }
    }
    return 'card'
  })

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    fetchItems()
  }, [router])

  useEffect(() => {
    if (!showModal || !editingId) {
      setFuelTanksForProduct([])
      setSelectedFuelTankId(null)
      return
    }
    let cancel = false
    ;(async () => {
      try {
        const r = await api.get('/tanks/')
        const rows = Array.isArray(r.data) ? r.data : []
        const list = rows.filter(
          (t: { product_id?: number; is_active?: boolean }) =>
            t.product_id === editingId && t.is_active !== false
        )
        if (cancel) return
        setFuelTanksForProduct(
          list.map((t: { id: number; tank_name: string }) => ({
            id: t.id,
            tank_name: t.tank_name || `Tank #${t.id}`
          }))
        )
        setSelectedFuelTankId(list[0]?.id ?? null)
      } catch {
        if (!cancel) {
          setFuelTanksForProduct([])
          setSelectedFuelTankId(null)
        }
      }
    })()
    return () => {
      cancel = true
    }
  }, [showModal, editingId])

  // Set video stream when camera is available
  useEffect(() => {
    if (cameraVideoRef && cameraStream) {
      cameraVideoRef.srcObject = cameraStream
      cameraVideoRef.play().catch(err => console.error('Error playing video:', err))
    }
    
    // Cleanup on unmount
    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop())
      }
    }
  }, [cameraVideoRef, cameraStream])

  const fetchItems = async () => {
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

      const token = localStorage.getItem('access_token')
      const response = await api.get('/items/', {
        headers: { Authorization: `Bearer ${token}` }
      })

      if (response.status === 200) {
        setItems(response.data)
      }
    } catch (error) {
      console.error('Error fetching items:', error)
      toast.error('Failed to load items')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    try {
      // Validate required fields
      if (!formData.name || formData.name.trim() === '') {
        toast.error('Item name is required')
        return
      }
      
      if (formData.unit_price === null || formData.unit_price === undefined || isNaN(formData.unit_price) || formData.unit_price < 0) {
        toast.error('Unit price must be a valid number greater than or equal to 0')
        return
      }
      
      if (formData.cost === null || formData.cost === undefined || isNaN(formData.cost) || formData.cost < 0) {
        toast.error('Cost must be a valid number greater than or equal to 0')
        return
      }
      
      const token = localStorage.getItem('access_token')
      const url = editingId ? `/items/${editingId}/` : '/items/'

      const qtyPayload: Record<string, unknown> = {
        quantity_on_hand:
          formData.item_type.toLowerCase() === 'inventory'
            ? Number(formData.quantity_on_hand) || 0
            : 0
      }
      if (
        editingId &&
        formData.item_type.toLowerCase() === 'inventory' &&
        fuelTanksForProduct.length > 1 &&
        selectedFuelTankId != null
      ) {
        qtyPayload.tank_id = selectedFuelTankId
      }

      const response = await api({
        method: editingId ? 'PUT' : 'POST',
        url,
        data: {
          name: formData.name.trim(),
          description: formData.description?.trim() || null,
          item_type: formData.item_type,
          unit_price: Number(formData.unit_price),
          cost: Number(formData.cost),
          ...qtyPayload,
          unit: formData.unit,
          pos_category: formData.pos_category || 'general',
          category: formData.category?.trim() || null,
          barcode: formData.barcode?.trim() || null,
          is_taxable: formData.is_taxable !== undefined ? formData.is_taxable : true,
          is_pos_available: formData.is_pos_available !== undefined ? formData.is_pos_available : true,
          is_active: formData.is_active !== undefined ? formData.is_active : true,
          image_url: formData.image_url?.trim() || null
        },
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      })

      if (response.status === 200 || response.status === 201) {
        toast.success(editingId ? 'Item updated successfully!' : 'Item created successfully!')
        setShowModal(false)
        setEditingId(null)
        fetchItems()
        resetForm()
      }
    } catch (error: any) {
      console.error(`Error ${editingId ? 'updating' : 'creating'} item:`, error)
      const errorMessage = extractErrorMessage(error, `Failed to ${editingId ? 'update' : 'create'} item`)
      toast.error(errorMessage)
    }
  }

  const populateEditorFromItem = useCallback((item: Item) => {
    setEditingId(item.id)
    setFormData({
      name: item.name,
      description: item.description || '',
      item_type: item.item_type.toLowerCase() as 'inventory' | 'non_inventory' | 'service',
      unit_price: item.unit_price,
      cost: item.cost,
      quantity_on_hand: parseInventoryQty(item.quantity_on_hand),
      unit: item.unit || 'piece',
      pos_category: (item as any).pos_category || 'general',
      is_pos_available:
        (item as any).is_pos_available !== undefined ? (item as any).is_pos_available : true,
      is_taxable: (item as any).is_taxable !== undefined ? (item as any).is_taxable : true,
      is_active: item.is_active !== undefined ? item.is_active : true,
      barcode: (item as any).barcode || '',
      category: (item as any).category || '',
      image_url: (item as any).image_url || '',
    })
    const itemImageUrl = (item as any).image_url
    if (itemImageUrl) {
      const apiBaseUrl = getBackendOrigin()
      const fullImageUrl = itemImageUrl.startsWith('http') ? itemImageUrl : `${apiBaseUrl}${itemImageUrl}`
      setImagePreview(fullImageUrl)
    } else {
      setImagePreview(null)
    }
  }, [])

  const handleEdit = (item: Item) => {
    populateEditorFromItem(item)
    setShowModal(true)
  }

  const handleDelete = async (id: number) => {
    if (
      !confirm(
        'Delete this item? If it is linked to fuel tanks or nozzles, the server will block the delete and nothing is removed. This cannot be undone.'
      )
    ) {
      return
    }

    try {
      const token = localStorage.getItem('access_token')
      const response = await api.delete(`/items/${id}/`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      if (response.status === 204 || response.status === 200) {
        toast.success('Item deleted successfully!')
        fetchItems()
      }
    } catch (error: any) {
      console.error('Error deleting item:', error)
      const errorMessage = extractErrorMessage(error, 'Failed to delete item')
      toast.error(errorMessage)
    }
  }

  const resetForm = useCallback(() => {
    setFormData({
      name: '',
      description: '',
      item_type: 'inventory',
      unit_price: 0,
      cost: 0,
      quantity_on_hand: 0,
      unit: 'piece',
      pos_category: 'general',
      is_pos_available: true,
      is_taxable: true,
      is_active: true,
      barcode: '',
      category: '',
      image_url: '',
    })
    setImagePreview(null)
    setEditingId(null)
  }, [])

  useEffect(() => {
    if (loading) return
    const editRaw = searchParams.get('edit')
    const wantNew = searchParams.get('new') === '1'

    if (editRaw) {
      const id = parseInt(editRaw, 10)
      if (Number.isNaN(id)) {
        router.replace('/items', { scroll: false })
        return
      }
      const item = items.find((i) => i.id === id)
      if (!item) {
        toast.error('Item not found.')
        router.replace('/items', { scroll: false })
        return
      }
      populateEditorFromItem(item)
      setShowModal(true)
      router.replace('/items', { scroll: false })
      return
    }

    if (wantNew) {
      resetForm()
      setShowModal(true)
      router.replace('/items', { scroll: false })
    }
  }, [loading, items, searchParams, router, toast, populateEditorFromItem, resetForm])

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      toast.error('Invalid file type. Please upload a JPEG, PNG, GIF, or WebP image.')
      return
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Image size must be less than 10MB.')
      return
    }

    setUploadingImage(true)
    try {
      const token = localStorage.getItem('access_token')
      const uploadPayload = new FormData()
      uploadPayload.append('file', file)

      const response = await api.post('/upload/items/image', uploadPayload, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data'
        }
      })

      if (response.data?.image_url) {
        const imageUrl = response.data.image_url
        setFormData((prev) => ({ ...prev, image_url: imageUrl }))
        // Set preview with full URL - image_url already includes /api/upload/items/...
        const apiBaseUrl = getBackendOrigin()
        const fullImageUrl = imageUrl.startsWith('http') ? imageUrl : `${apiBaseUrl}${imageUrl}`
        setImagePreview(fullImageUrl)
        toast.success('Image uploaded and resized successfully!')
      }
    } catch (error: any) {
      console.error('Error uploading image:', error)
      toast.error('Failed to upload image. Please try again.')
    } finally {
      setUploadingImage(false)
    }
  }

  const handleRemoveImage = () => {
    setFormData((prev) => ({ ...prev, image_url: '' }))
    setImagePreview(null)
  }

  const startCamera = async () => {
    try {
      // Request camera access
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: 'environment', // Use back camera on mobile
          width: { ideal: 1280 },
          height: { ideal: 1280 }
        }
      })
      
      setCameraStream(stream)
      setShowCamera(true)
    } catch (error: any) {
      console.error('Error accessing camera:', error)
      let errorMessage = 'Could not access camera. '
      if (error.name === 'NotAllowedError') {
        errorMessage += 'Please allow camera access in your browser settings.'
      } else if (error.name === 'NotFoundError') {
        errorMessage += 'No camera found on this device.'
      } else {
        errorMessage += 'Please check permissions or use file upload instead.'
      }
      toast.error(errorMessage)
    }
  }

  const stopCamera = () => {
    if (cameraStream) {
      cameraStream.getTracks().forEach(track => track.stop())
      setCameraStream(null)
    }
    setShowCamera(false)
    if (cameraVideoRef) {
      cameraVideoRef.srcObject = null
    }
  }

  const capturePhoto = async () => {
    if (!cameraVideoRef) return

    try {
      // Create canvas to capture frame
      const canvas = document.createElement('canvas')
      canvas.width = cameraVideoRef.videoWidth
      canvas.height = cameraVideoRef.videoHeight
      
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      
      // Draw video frame to canvas
      ctx.drawImage(cameraVideoRef, 0, 0, canvas.width, canvas.height)
      
      // Convert canvas to blob
      canvas.toBlob(async (blob) => {
        if (!blob) return
        
        // Stop camera
        stopCamera()
        
        // Create file from blob
        const file = new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' })
        
        // Upload the captured image
        setUploadingImage(true)
        try {
          const token = localStorage.getItem('access_token')
          const formData = new FormData()
          formData.append('file', file)

          const response = await api.post('/upload/items/image', formData, {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'multipart/form-data'
            }
          })

          if (response.data?.image_url) {
            const imageUrl = response.data.image_url
            setFormData((prev) => ({ ...prev, image_url: imageUrl }))
            // Set preview with full URL
            const apiBaseUrl = getBackendOrigin()
            const fullImageUrl = imageUrl.startsWith('http') ? imageUrl : `${apiBaseUrl}${imageUrl}`
            setImagePreview(fullImageUrl)
            toast.success('Photo captured and uploaded successfully!')
          }
        } catch (error: any) {
          console.error('Error uploading captured image:', error)
          toast.error('Failed to upload captured image. Please try again.')
        } finally {
          setUploadingImage(false)
        }
      }, 'image/jpeg', 0.9)
    } catch (error: any) {
      console.error('Error capturing photo:', error)
      toast.error('Failed to capture photo. Please try again.')
    }
  }

  const filteredItems = items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         item.item_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         (item.description && item.description.toLowerCase().includes(searchTerm.toLowerCase()))

    // Normalize to lowercase for case-insensitive comparison
    // Backend returns: "inventory", "non_inventory", "service" (lowercase)
    const itemTypeLower = item.item_type.toLowerCase()
    let matchesType = false
    
    if (filterType === 'ALL') {
      matchesType = true
    } else if (filterType === 'INVENTORY') {
      matchesType = itemTypeLower === 'inventory'
    } else if (filterType === 'NON_INVENTORY') {
      // Backend returns "non_inventory" (with underscore)
      matchesType = itemTypeLower === 'non_inventory'
    } else if (filterType === 'SERVICE') {
      matchesType = itemTypeLower === 'service'
    }

    return matchesSearch && matchesType
  })

  const getItemIcon = (type: string) => {
    const typeUpper = type.toUpperCase()
    switch (typeUpper) {
      case 'INVENTORY':
        return <Package className="h-6 w-6" />
      case 'NON_INVENTORY':
      case 'NONINVENTORY':
        return <Box className="h-6 w-6" />
      case 'SERVICE':
        return <Wrench className="h-6 w-6" />
      default:
        return <Package className="h-6 w-6" />
    }
  }

  const getItemColor = (type: string) => {
    const typeUpper = type.toUpperCase()
    switch (typeUpper) {
      case 'INVENTORY':
        return 'bg-blue-100 text-blue-600'
      case 'NON_INVENTORY':
      case 'NONINVENTORY':
        return 'bg-purple-100 text-purple-600'
      case 'SERVICE':
        return 'bg-green-100 text-green-600'
      default:
        return 'bg-gray-100 text-gray-600'
    }
  }

  const itemTypeCounts = {
    ALL: items.length,
    INVENTORY: items.filter(i => i.item_type.toLowerCase() === 'inventory').length,
    NON_INVENTORY: items.filter(i => i.item_type.toLowerCase() === 'non_inventory').length,
    SERVICE: items.filter(i => i.item_type.toLowerCase() === 'service').length,
  }

  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto p-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Products & Services</h1>
          <p className="text-gray-600 mt-1">Manage inventory, non-inventory items, and services</p>
        </div>

        {/* Filter Tabs */}
        <div className="mb-6 flex items-center space-x-2 overflow-x-auto">
          {['ALL', 'INVENTORY', 'NON_INVENTORY', 'SERVICE'].map((type) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-colors ${
                filterType === type
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {type.replace('_', ' ')} ({itemTypeCounts[type as keyof typeof itemTypeCounts]})
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between mb-6">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-5 w-5" />
            <input
              type="text"
              placeholder="Search items..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          <div className="flex items-center space-x-3">
            {/* View Toggle */}
            <div className="flex items-center bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => {
                  setViewMode('card')
                  localStorage.setItem('items_view_mode', 'card')
                }}
                className={`p-2 rounded transition-colors ${
                  viewMode === 'card'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
                title="Card View"
              >
                <Grid3x3 className="h-5 w-5" />
              </button>
              <button
                onClick={() => {
                  setViewMode('list')
                  localStorage.setItem('items_view_mode', 'list')
                }}
                className={`p-2 rounded transition-colors ${
                  viewMode === 'list'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
                title="List View"
              >
                <List className="h-5 w-5" />
              </button>
            </div>

            <button
              onClick={() => {
                resetForm()
                setShowModal(true)
              }}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="h-5 w-5" />
              <span>Add Item</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <Package className="h-16 w-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No items found</h3>
            <p className="text-gray-600 mb-4">Get started by creating your first product or service</p>
            <button
              onClick={() => setShowModal(true)}
              className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              <Plus className="h-5 w-5" />
              <span>Add Item</span>
            </button>
          </div>
        ) : viewMode === 'card' ? (
          // Card View
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredItems.map((item) => (
              <div key={item.id} className="bg-white rounded-lg shadow hover:shadow-lg transition-shadow p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    <div className={`p-3 rounded-lg ${getItemColor(item.item_type)}`}>
                      {getItemIcon(item.item_type)}
                    </div>
                    <div>
                      <h3 className="font-bold text-lg text-gray-900">{item.name}</h3>
                      <p className="text-sm text-gray-500">{item.item_number}</p>
                    </div>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                    item.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                  }`}>
                    {item.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                {/* Item Image */}
                {item.image_url && (
                  <div className="mb-4 flex justify-center">
                    <img
                      src={(() => {
                        if (item.image_url.startsWith('http')) return item.image_url
                        const apiBaseUrl = getApiBaseUrl()
                        const baseUrl = apiBaseUrl.replace('/api', '')
                        return `${baseUrl}${item.image_url}`
                      })()}
                      alt={item.name}
                      className="h-32 w-32 object-contain rounded-lg border border-gray-200 bg-gray-50"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none'
                      }}
                    />
                  </div>
                )}

                {item.description && (
                  <p className="text-sm text-gray-600 mb-4 line-clamp-2">{item.description}</p>
                )}

                <div className="space-y-2 mb-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Type:</span>
                    <span className="font-medium text-gray-900">
                      {item.item_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Unit Price:</span>
                    <span className="font-medium text-green-600">{currencySymbol}{Number(item.unit_price || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Cost:</span>
                    <span className="font-medium text-gray-900">{currencySymbol}{Number(item.cost || 0).toFixed(2)}</span>
                  </div>
                  {(item.item_type.toUpperCase() === 'INVENTORY' || item.item_type.toLowerCase() === 'inventory') && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">On Hand:</span>
                      <span className="font-medium text-gray-900">
                        {parseInventoryQty(item.quantity_on_hand).toFixed(2)} {item.unit}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end space-x-2 pt-4 border-t">
                  <button
                    onClick={() => handleEdit(item)}
                    className="p-2 text-blue-600 hover:bg-blue-50 rounded"
                    title="Edit Item"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded"
                    title="Delete Item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          // List View
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Image
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Item
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Unit Price
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Cost
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    On Hand
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      {item.image_url ? (
                        <img
                          src={(() => {
                            if (item.image_url.startsWith('http')) return item.image_url
                            const apiBaseUrl = getApiBaseUrl()
                            const baseUrl = apiBaseUrl.replace('/api', '')
                            return `${baseUrl}${item.image_url}`
                          })()}
                          alt={item.name}
                          className="h-16 w-16 object-contain rounded border border-gray-200 bg-gray-50"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none'
                          }}
                        />
                      ) : (
                        <div className={`h-16 w-16 rounded flex items-center justify-center ${getItemColor(item.item_type)}`}>
                          {getItemIcon(item.item_type)}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <div>
                        <div className="text-sm font-semibold text-gray-900">{item.name}</div>
                        <div className="text-sm text-gray-500">{item.item_number}</div>
                        {item.description && (
                          <div className="text-xs text-gray-400 mt-1 line-clamp-1">{item.description}</div>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getItemColor(item.item_type)}`}>
                        {item.item_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-green-600">
                      {currencySymbol}{Number(item.unit_price || 0).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {currencySymbol}{Number(item.cost || 0).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {(item.item_type.toUpperCase() === 'INVENTORY' || item.item_type.toLowerCase() === 'inventory') ? (
                        <span>
                          {parseInventoryQty(item.quantity_on_hand).toFixed(2)} {item.unit}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${
                        item.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}>
                        {item.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <div className="flex items-center justify-end space-x-2">
                        <button
                          onClick={() => handleEdit(item)}
                          className="p-2 text-blue-600 hover:bg-blue-50 rounded transition-colors"
                          title="Edit Item"
                        >
                          <Edit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(item.id)}
                          className="p-2 text-red-600 hover:bg-red-50 rounded transition-colors"
                          title="Delete Item"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Create/Edit Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-2xl font-bold mb-6">
                {editingId ? 'Edit Item' : 'Add New Item'}
              </h2>
              <form onSubmit={handleSubmit}>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Item Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g., Premium Diesel"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Description
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="Optional description"
                      rows={3}
                    />
                  </div>

                  {/* Product Image Upload */}
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Product Image (Optional)
                    </label>
                    <div className="space-y-3">
                      {imagePreview ? (
                        <div className="relative inline-block">
                          <img
                            src={imagePreview}
                            alt="Product preview"
                            className="w-32 h-32 object-contain border border-gray-300 rounded-lg bg-gray-50"
                          />
                          <button
                            type="button"
                            onClick={handleRemoveImage}
                            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600 text-xs"
                            title="Remove image"
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        <div className="w-32 h-32 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center bg-gray-50">
                          <span className="text-gray-400 text-xs text-center px-2">No image</span>
                        </div>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <input
                          type="file"
                          accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
                          onChange={handleImageUpload}
                          disabled={uploadingImage || showCamera}
                          className="hidden"
                          id="image-upload"
                        />
                        <label
                          htmlFor="image-upload"
                          className={`inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg cursor-pointer ${
                            uploadingImage || showCamera
                              ? 'bg-gray-100 cursor-not-allowed text-gray-400'
                              : 'bg-white hover:bg-gray-50'
                          }`}
                        >
                          {uploadingImage ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                              <span className="text-sm text-gray-600">Uploading...</span>
                            </>
                          ) : (
                            <>
                              <span className="text-sm text-gray-700">📁 Upload from Device</span>
                            </>
                          )}
                        </label>
                        <button
                          type="button"
                          onClick={startCamera}
                          disabled={uploadingImage || showCamera}
                          className={`inline-flex items-center px-4 py-2 border rounded-lg ${
                            uploadingImage || showCamera
                              ? 'bg-gray-100 cursor-not-allowed text-gray-400 border-gray-300'
                              : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-300'
                          }`}
                        >
                          <Camera className="h-4 w-4 mr-2" />
                          <span className="text-sm font-medium">📷 Capture Photo</span>
                        </button>
                        <p className="w-full mt-1 text-xs text-gray-500">
                          Image will be automatically resized to fit (max 800x800px). JPG, PNG, GIF, WebP supported.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Item Type *
                    </label>
                    <select
                      required
                      value={formData.item_type}
                      onChange={(e) => setFormData({ ...formData, item_type: e.target.value as any })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="inventory">Inventory</option>
                      <option value="non_inventory">Non-Inventory</option>
                      <option value="service">Service</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Unit of Measure *
                    </label>
                    <select
                      required
                      value={formData.unit}
                      onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="piece">Piece</option>
                      <option value="liter">Liter (L)</option>
                      <option value="meter">Meter (m)</option>
                      <option value="kg">Kilogram (kg)</option>
                      <option value="gram">Gram (g)</option>
                      <option value="gallon">Gallon (gal)</option>
                      <option value="each">Each</option>
                      <option value="box">Box</option>
                      <option value="pack">Pack</option>
                      <option value="bottle">Bottle</option>
                      <option value="can">Can</option>
                      <option value="bag">Bag</option>
                      <option value="carton">Carton</option>
                      <option value="hour">Hour</option>
                      <option value="day">Day</option>
                      <option value="month">Month</option>
                      <option value="year">Year</option>
                      <option value="service">Service</option>
                    </select>
                    <p className="mt-1 text-xs text-gray-500">
                      Select the unit of measure for this item
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Unit Price *
                    </label>
                    <input
                      type="number"
                      required
                      min="0"
                      step="0.01"
                      value={formData.unit_price}
                      onChange={(e) => {
                        const value = e.target.value === '' ? 0 : parseFloat(e.target.value)
                        setFormData({ ...formData, unit_price: isNaN(value) ? 0 : value })
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Cost *
                    </label>
                    <input
                      type="number"
                      required
                      min="0"
                      step="0.01"
                      value={formData.cost}
                      onChange={(e) => {
                        const value = e.target.value === '' ? 0 : parseFloat(e.target.value)
                        setFormData({ ...formData, cost: isNaN(value) ? 0 : value })
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {formData.item_type === 'inventory' && (
                    <div className="space-y-2">
                      {fuelTanksForProduct.length > 1 && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Fuel tank (quantity applies here)
                          </label>
                          <select
                            value={selectedFuelTankId ?? ''}
                            onChange={(e) =>
                              setSelectedFuelTankId(
                                e.target.value ? parseInt(e.target.value, 10) : null
                              )
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                          >
                            {fuelTanksForProduct.map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.tank_name}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Quantity on Hand
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={formData.quantity_on_hand}
                          onChange={(e) => {
                            const value = e.target.value === '' ? 0 : parseFloat(e.target.value)
                            setFormData({ ...formData, quantity_on_hand: isNaN(value) ? 0 : value })
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                        <p className="mt-1 text-xs text-gray-500">
                          {fuelTanksForProduct.length > 0
                            ? `Fuel stock is stored in tank(s); list view shows total across tanks. ${
                                fuelTanksForProduct.length === 1
                                  ? 'This value updates that tank.'
                                  : 'With multiple tanks, pick which tank to set above.'
                              }`
                            : `Current quantity in ${formData.unit}`}
                        </p>
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      POS Category
                    </label>
                    <select
                      value={formData.pos_category}
                      onChange={(e) => setFormData({ ...formData, pos_category: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="general">General (For POS General Items Tab)</option>
                      <option value="fuel">Fuel (For POS Fuel Tab - Linked to Tanks)</option>
                      <option value="service">Service</option>
                      <option value="other">Other</option>
                    </select>
                    <p className="mt-1 text-xs text-gray-500">
                      General items appear in POS General Products tab. Fuel items are linked to tanks and appear in Fuel Sale tab.
                    </p>
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Category (Optional)
                    </label>
                    <input
                      type="text"
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g., Electronics, Food, Beverages"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Barcode (Optional)
                    </label>
                    <input
                      type="text"
                      value={formData.barcode}
                      onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="Scan or enter barcode"
                    />
                  </div>

                  <div className="col-span-2">
                    <div className="flex items-center space-x-6">
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={formData.is_pos_available}
                          onChange={(e) => setFormData({ ...formData, is_pos_available: e.target.checked })}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm font-medium text-gray-700">Available in POS</span>
                      </label>
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={formData.is_taxable}
                          onChange={(e) => setFormData({ ...formData, is_taxable: e.target.checked })}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm font-medium text-gray-700">Taxable</span>
                      </label>
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={formData.is_active}
                          onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm font-medium text-gray-700">Active</span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
                  <p className="text-sm text-blue-800">
                    <strong>Item Types:</strong><br />
                    <strong>Inventory:</strong> Track quantities (fuel products)<br />
                    <strong>Non-Inventory:</strong> Don't track quantities (consumables)<br />
                    <strong>Service:</strong> Services provided (labor, maintenance)
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
                    {editingId ? 'Update Item' : 'Add Item'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Camera Capture Modal */}
        {showCamera && (
          <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50">
            <div className="bg-black rounded-lg p-4 w-full max-w-md">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-white text-lg font-semibold">Capture Photo</h3>
                <button
                  type="button"
                  onClick={stopCamera}
                  className="text-white hover:text-gray-300"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>
              
              <div className="relative bg-black rounded-lg overflow-hidden mb-4">
                <video
                  ref={(el) => {
                    setCameraVideoRef(el)
                    if (el && cameraStream) {
                      el.srcObject = cameraStream
                      el.play().catch(err => console.error('Error playing video:', err))
                    }
                  }}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-auto max-h-[60vh] object-contain"
                />
                <div className="absolute bottom-4 left-0 right-0 flex justify-center">
                  <button
                    type="button"
                    onClick={capturePhoto}
                    className="w-16 h-16 rounded-full bg-white border-4 border-gray-300 hover:bg-gray-100 flex items-center justify-center shadow-lg"
                    title="Capture Photo"
                  >
                    <div className="w-12 h-12 rounded-full bg-white border-2 border-gray-400"></div>
                  </button>
                </div>
              </div>
              
              <div className="flex justify-center space-x-3">
                <button
                  type="button"
                  onClick={stopCamera}
                  className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={capturePhoto}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Capture Photo
                </button>
              </div>
              
              <p className="text-white text-xs text-center mt-4 text-gray-400">
                Position the product in the frame and tap the capture button
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}












