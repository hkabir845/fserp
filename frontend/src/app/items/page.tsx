'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Sidebar from '@/components/Sidebar'
import { Plus, Edit, Trash2, Search, Package, Box, Wrench, Camera, X, Grid3x3, List, ArrowRightLeft } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api, { getApiBaseUrl, getBackendOrigin } from '@/lib/api'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { extractErrorMessage } from '@/utils/errorHandler'
import { ReferenceCodePicker } from '@/components/ReferenceCodePicker'

/** Match backend duplicate-name rules: trim, collapse spaces, case-insensitive. */
function normalizeItemNameKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** API returns decimals as strings; tanks-backed quantity is merged server-side. */
function parseInventoryQty(raw: unknown): number {
  if (raw == null) return 0
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  const n = parseFloat(String(raw).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : 0
}

function itemHasPerStationShopStock(item: Item): boolean {
  const t = String(item.item_type).toLowerCase()
  if (t !== 'inventory') return false
  const pc = (item.pos_category || '').toLowerCase()
  if (pc === 'fuel' || pc === 'non_pos') return false
  return true
}

/** Stock is in selling units (e.g. sacks); optional labeled kg per unit for feed. */
function feedApproxTotalKg(item: Item): number | null {
  if ((item.pos_category || '').toLowerCase() !== 'feed') return null
  const raw = (item as Item & { content_weight_kg?: unknown }).content_weight_kg
  const kgPer = raw != null && raw !== '' ? Number(raw) : NaN
  if (!Number.isFinite(kgPer) || kgPer <= 0) return null
  const sacks = parseInventoryQty(item.quantity_on_hand)
  const t = Number(sacks * kgPer)
  return Number.isFinite(t) ? t : null
}

/** Labels for feed: price/cost are BDT per sack; kg is defined by content_weight_kg. */
function feedSackPriceLabelSuffix(contentWeightKg: number | string | ''): string {
  const n = typeof contentWeightKg === 'number' ? contentWeightKg : parseFloat(String(contentWeightKg))
  if (!Number.isFinite(n) || n <= 0) return ''
  return `, one sack = ${n} kg feed`
}

function formatFeedSackQuantityLabel(qty: number): string {
  const q = Number.isFinite(qty) ? qty : 0
  return `${formatNumber(q)} ${q === 1 ? 'sack' : 'sacks'}`
}

interface ProductTankRow {
  id: number
  tank_name: string
}

/** Per-station shop bin quantities when the company tracks inventory by location. */
interface ShopStationRow {
  station_id: number
  station_name: string
  quantity: number
}

function useNonPassiveWheelPreventRef() {
  return useCallback((node: HTMLInputElement | null) => {
    if (!node) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      node.removeEventListener('wheel', onWheel)
    }
  }, [])
}

/** Money fields use plain text + parse at save so large BDT values (e.g. 1900) edit reliably (controlled type="number" often fights paste/step). */
function parseMoneyField(s: string): number {
  const t = String(s ?? '')
    .replace(/,/g, '')
    .trim()
  if (t === '') return NaN
  const n = parseFloat(t)
  return Number.isFinite(n) ? n : NaN
}

/** Strip to digits, optional comma, one dot (for typing / IME quirks). */
function normalizeMoneyTyping(raw: string): string {
  let out = ''
  let dotSeen = false
  for (const ch of raw.replace(/,/g, '')) {
    if (ch >= '0' && ch <= '9') {
      out += ch
    } else if (ch === '.' && !dotSeen) {
      out += ch
      dotSeen = true
    }
  }
  return out
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
  /** Labeled kg per selling unit (e.g. kg per sack) when POS category is feed */
  content_weight_kg?: number | string | null
}

/** Feed: catch sack weight (e.g. 25 kg) saved as BDT unit_price while cost is per-sack in hundreds/thousands. */
function feedSellingPriceSuspiciousMessage(
  unitPrice: number,
  cost: number,
  kgPerSack: number
): string | null {
  if (!Number.isFinite(unitPrice) || unitPrice <= 0 || !Number.isFinite(cost) || cost <= 0) {
    return null
  }
  if (
    Number.isFinite(kgPerSack) &&
    kgPerSack > 0 &&
    Math.abs(unitPrice - kgPerSack) < 1e-6 &&
    kgPerSack >= 0.5 &&
    kgPerSack <= 500
  ) {
    return (
      'Selling price matches kg per sack — weight belongs in “Kg per sack”, not here. Clear this field and type the full BDT per sack (e.g. 1900); this notice goes away when they differ.'
    )
  }
  if (cost >= 1200 && unitPrice <= 200 && unitPrice < cost * 0.02) {
    return (
      'Selling price is far below cost (often sack weight was typed as price, e.g. 25 instead of 1900 BDT per sack). Fix BDT per sack.'
    )
  }
  return null
}

type ItemFormData = {
  name: string
  description: string
  item_type: 'inventory' | 'non_inventory' | 'service'
  unit_price: string
  cost: string
  quantity_on_hand: number
  unit: string
  pos_category: string
  is_pos_available: boolean
  is_taxable: boolean
  is_active: boolean
  barcode: string
  category: string
  image_url: string
  content_weight_kg: number | string
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
  const [itemRefCode, setItemRefCode] = useState('')
  const [createItemCodeNonce, setCreateItemCodeNonce] = useState(0)
  const [currencySymbol, setCurrencySymbol] = useState<string>('৳') // Default to BDT
  const [formData, setFormData] = useState<ItemFormData>({
    name: '',
    description: '',
    item_type: 'inventory',
    unit_price: '0',
    cost: '0',
    quantity_on_hand: 0,
    unit: 'piece',
    pos_category: 'general',
    is_pos_available: true,
    is_taxable: true,
    is_active: true,
    barcode: '',
    category: 'General',
    image_url: '',
    content_weight_kg: '',
  })
  const [fuelTanksForProduct, setFuelTanksForProduct] = useState<ProductTankRow[]>([])
  const [selectedFuelTankId, setSelectedFuelTankId] = useState<number | null>(null)
  const [fuelTanksLoading, setFuelTanksLoading] = useState(false)
  const [shopStationRows, setShopStationRows] = useState<ShopStationRow[]>([])
  const [selectedShopStationId, setSelectedShopStationId] = useState<number | null>(null)
  const [shopStockLoading, setShopStockLoading] = useState(false)

  /** React's onWheel is passive; non-passive listeners stop number inputs changing on scroll. */
  const contentWeightWheelRef = useNonPassiveWheelPreventRef()
  const qtyOnHandWheelRef = useNonPassiveWheelPreventRef()
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [showCamera, setShowCamera] = useState(false)
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null)
  const [cameraVideoRef, setCameraVideoRef] = useState<HTMLVideoElement | null>(null)
  const [categoryPresets, setCategoryPresets] = useState<string[]>([])
  const [categoryCustomInUse, setCategoryCustomInUse] = useState<string[]>([])

  /**
   * Opening /items?edit=123 or ?new=1 must hydrate the modal once. The effect also depends on `items`,
   * which refreshes after saves and other updates — re-calling populateEditorFromItem/resetForm would
   * wipe every in-progress field change (felt like "the form never updates").
   */
  const urlEditHydratedIdRef = useRef<number | null>(null)
  const urlNewHydratedRef = useRef(false)

  /** Default must match SSR; hydrate from localStorage after mount to avoid hydration mismatch. */
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card')

  useEffect(() => {
    try {
      const saved = localStorage.getItem('items_view_mode')
      if (saved === 'card' || saved === 'list') {
        setViewMode(saved)
      }
    } catch {
      /* private mode / no storage */
    }
  }, [])

  const loadCategoryOptions = useCallback(async () => {
    try {
      const token = localStorage.getItem('access_token')
      if (!token) return
      const r = await api.get('/items/categories/', { headers: { Authorization: `Bearer ${token}` } })
      if (Array.isArray(r.data?.presets)) setCategoryPresets(r.data.presets)
      if (Array.isArray(r.data?.custom_in_use)) setCategoryCustomInUse(r.data.custom_in_use)
    } catch {
      /* keep empty; form still works with manual entry */
    }
  }, [])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    fetchItems()
    loadCategoryOptions()
  }, [router, loadCategoryOptions])

  useEffect(() => {
    if (showModal) void loadCategoryOptions()
  }, [showModal, loadCategoryOptions])

  useEffect(() => {
    if (!showModal || !editingId) {
      setFuelTanksForProduct([])
      setSelectedFuelTankId(null)
      setFuelTanksLoading(false)
      return
    }
    let cancel = false
    setFuelTanksLoading(true)
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
      } finally {
        if (!cancel) setFuelTanksLoading(false)
      }
    })()
    return () => {
      cancel = true
    }
  }, [showModal, editingId])

  /** Hydrate per-station shop bins so PUT sends station_id when the company has multiple active sites. */
  useEffect(() => {
    if (!showModal || !editingId) {
      setShopStationRows([])
      setSelectedShopStationId(null)
      setShopStockLoading(false)
      return
    }
    const pc = (formData.pos_category || '').toLowerCase()
    if (pc === 'non_pos' || pc === 'fuel') {
      setShopStationRows([])
      setSelectedShopStationId(null)
      setShopStockLoading(false)
      return
    }
    let cancel = false
    setShopStockLoading(true)
    ;(async () => {
      try {
        const token = localStorage.getItem('access_token')
        if (!token) {
          if (!cancel) {
            setShopStationRows([])
            setSelectedShopStationId(null)
          }
          return
        }
        const r = await api.get(`/items/${editingId}/`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (cancel) return
        const data = r.data as { location_stocks?: unknown }
        if (!data || !('location_stocks' in data) || !Array.isArray(data.location_stocks)) {
          setShopStationRows([])
          setSelectedShopStationId(null)
          return
        }
        const loc = data.location_stocks as { station_id?: number; station_name?: string; quantity?: string }[]
        const stRes = await api.get('/stations/', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (cancel) return
        const stations = Array.isArray(stRes.data) ? stRes.data : []
        const active = stations.filter((s: { is_active?: boolean }) => s.is_active !== false)
        if (active.length <= 1) {
          setShopStationRows([])
          setSelectedShopStationId(null)
          return
        }
        const qtyByStation = new Map<number, number>()
        for (const row of loc) {
          const sid = row.station_id
          if (sid == null) continue
          const q = parseFloat(String(row.quantity ?? '0').replace(/,/g, ''))
          qtyByStation.set(sid, Number.isFinite(q) ? q : 0)
        }
        const merged: ShopStationRow[] = active.map((s: { id: number; station_name?: string }) => ({
          station_id: s.id,
          station_name: (s.station_name || `Station #${s.id}`).trim(),
          quantity: qtyByStation.get(s.id) ?? 0,
        }))
        setShopStationRows(merged)
        const firstId = merged[0]?.station_id ?? null
        setSelectedShopStationId(firstId)
        const firstQty = merged[0]?.quantity ?? 0
        if (firstId != null) {
          setFormData((prev) => ({ ...prev, quantity_on_hand: firstQty }))
        }
      } catch {
        if (!cancel) {
          setShopStationRows([])
          setSelectedShopStationId(null)
        }
      } finally {
        if (!cancel) setShopStockLoading(false)
      }
    })()
    return () => {
      cancel = true
    }
  }, [showModal, editingId, formData.pos_category])

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
      const upRaw = formData.unit_price
      const coRaw = formData.cost

      // Validate required fields
      if (!formData.name || formData.name.trim() === '') {
        toast.error('Item name is required')
        return
      }
      
      const unitPriceNum = parseMoneyField(upRaw)
      if (!Number.isFinite(unitPriceNum) || unitPriceNum < 0) {
        toast.error('Unit price must be a valid number greater than or equal to 0')
        return
      }

      const costNum = parseMoneyField(coRaw)
      if (!Number.isFinite(costNum) || costNum < 0) {
        toast.error('Cost must be a valid number greater than or equal to 0')
        return
      }

      const nameKey = normalizeItemNameKey(formData.name)
      const nameDuplicate = items.some(
        (it) => it.id !== editingId && normalizeItemNameKey(it.name) === nameKey
      )
      if (nameDuplicate) {
        toast.error('An item with this name already exists for this company.')
        return
      }

      const categoryTrim = formData.category?.trim() || ''
      if (!categoryTrim) {
        toast.error('Reporting category is required (e.g. General, Fuel, Fish feed).')
        return
      }

      if (formData.item_type.toLowerCase() === 'inventory') {
        const q = Number(formData.quantity_on_hand)
        if (isNaN(q) || q < 0) {
          toast.error('Quantity on hand must be zero or greater')
          return
        }
      }

      const isInventory = formData.item_type.toLowerCase() === 'inventory'
      const isFuelPos = (formData.pos_category || '').toLowerCase() === 'fuel'

      if (editingId && isInventory && isFuelPos && fuelTanksLoading) {
        toast.error('Loading fuel tank information… please wait a moment, then save again.')
        return
      }
      if (
        editingId &&
        isInventory &&
        isFuelPos &&
        fuelTanksForProduct.length > 1 &&
        selectedFuelTankId == null
      ) {
        toast.error('Select a fuel tank before saving stock for this product.')
        return
      }
      if (editingId && isInventory && shopStockLoading) {
        toast.error('Loading location stock… please wait a moment, then save again.')
        return
      }
      if (
        editingId &&
        isInventory &&
        shopStationRows.length > 1 &&
        selectedShopStationId == null
      ) {
        toast.error('Select which shop location to update before saving quantity.')
        return
      }

      const isFeed = (formData.pos_category || '').toLowerCase() === 'feed'
      if (isFeed) {
        const kgRaw =
          formData.content_weight_kg === '' || formData.content_weight_kg == null
            ? NaN
            : Number(formData.content_weight_kg)
        if (!Number.isFinite(kgRaw) || kgRaw <= 0) {
          toast.error('Enter kg per sack (the weight printed on each sack) for feed items.')
          return
        }
        if (kgRaw > 2000) {
          toast.error(
            'Kg per sack cannot exceed 2000. That field is weight in kg (e.g. 25), not the price in BDT.'
          )
          return
        }
        if (
          unitPriceNum > 0 &&
          kgRaw > 100 &&
          kgRaw > unitPriceNum * 15
        ) {
          toast.error(
            'Kg per sack looks larger than your sack price — fields may be reversed. ' +
              'Unit price = BDT per sack (e.g. 1900). Kg per sack = weight on the bag (e.g. 25).'
          )
          return
        }
        // Suspicion is shown inline only; do not block save (false positives blocked legitimate edits).
      }

      const token = localStorage.getItem('access_token')
      const url = editingId ? `/items/${editingId}/` : '/items/'

      const qtyPayload: Record<string, unknown> = {
        quantity_on_hand:
          formData.item_type.toLowerCase() === 'inventory'
            ? Number(formData.quantity_on_hand) || 0
            : 0
      }
      if (editingId && isInventory && fuelTanksForProduct.length > 1) {
        qtyPayload.tank_id = selectedFuelTankId
      }
      if (editingId && isInventory && shopStationRows.length > 1 && selectedShopStationId != null) {
        qtyPayload.station_id = selectedShopStationId
      }

      const response = await api({
        method: editingId ? 'PUT' : 'POST',
        url,
        data: {
          name: formData.name.trim(),
          description: formData.description?.trim() || null,
          item_type: formData.item_type,
          unit_price: unitPriceNum,
          cost: costNum,
          ...qtyPayload,
          unit: formData.unit,
          pos_category: formData.pos_category || 'general',
          category: categoryTrim,
          barcode: formData.barcode?.trim() || null,
          is_taxable: formData.is_taxable !== undefined ? formData.is_taxable : true,
          is_pos_available:
            (formData.pos_category || '').toLowerCase() === 'non_pos'
              ? false
              : formData.is_pos_available !== undefined
                ? formData.is_pos_available
                : true,
          is_active: formData.is_active !== undefined ? formData.is_active : true,
          image_url: formData.image_url?.trim() || null,
          content_weight_kg: isFeed
            ? Number(
                formData.content_weight_kg === '' || formData.content_weight_kg == null
                  ? NaN
                  : formData.content_weight_kg
              )
            : null,
          ...(!editingId && itemRefCode.trim() ? { item_number: itemRefCode.trim() } : {}),
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
        void loadCategoryOptions()
        resetForm()
      }
    } catch (error: any) {
      console.error(`Error ${editingId ? 'updating' : 'creating'} item:`, error)
      const errorMessage = extractErrorMessage(error, `Failed to ${editingId ? 'update' : 'create'} item`)
      const status = error?.response?.status as number | undefined
      const qtyRuleHint =
        status === 400 &&
        editingId &&
        (errorMessage.includes('multiple stations') ||
          errorMessage.includes('multiple active fuel tanks') ||
          errorMessage.includes('Send station_id') ||
          errorMessage.includes('Send tank_id'))
      if (qtyRuleHint) {
        toast.error(
          `${errorMessage} If you only changed price or cost, those values may already be saved — check the list after fixing quantity/station settings.`
        )
        void fetchItems()
      } else {
        toast.error(errorMessage)
      }
    }
  }

  const populateEditorFromItem = useCallback((item: Item) => {
    setEditingId(item.id)
    const up = Number(item.unit_price)
    const co = Number(item.cost)
    const uStr = Number.isFinite(up) ? String(up) : '0'
    const cStr = Number.isFinite(co) ? String(co) : '0'
    setFormData({
      name: item.name,
      description: item.description || '',
      item_type: item.item_type.toLowerCase() as 'inventory' | 'non_inventory' | 'service',
      unit_price: uStr,
      cost: cStr,
      quantity_on_hand: parseInventoryQty(item.quantity_on_hand),
      unit: item.unit || 'piece',
      pos_category: (item as any).pos_category || 'general',
      is_pos_available:
        (item as any).is_pos_available !== undefined ? (item as any).is_pos_available : true,
      is_taxable: (item as any).is_taxable !== undefined ? (item as any).is_taxable : true,
      is_active: item.is_active !== undefined ? item.is_active : true,
      barcode: (item as any).barcode || '',
      category: (item as any).category?.trim() || 'General',
      image_url: (item as any).image_url || '',
      content_weight_kg: (() => {
        const raw = (item as Item & { content_weight_kg?: unknown }).content_weight_kg
        if (raw == null || raw === '') return '' as const
        const n = Number(raw)
        return Number.isFinite(n) ? n : ('' as const)
      })(),
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
      unit_price: '0',
      cost: '0',
      quantity_on_hand: 0,
      unit: 'piece',
      pos_category: 'general',
      is_pos_available: true,
      is_taxable: true,
      is_active: true,
      barcode: '',
      category: 'General',
      image_url: '',
      content_weight_kg: '',
    })
    setImagePreview(null)
    setItemRefCode('')
    setEditingId(null)
  }, [])

  useEffect(() => {
    if (loading) return
    const editRaw = searchParams.get('edit')
    const wantNew = searchParams.get('new') === '1'

    if (editRaw) {
      const id = parseInt(editRaw, 10)
      if (Number.isNaN(id)) {
        urlEditHydratedIdRef.current = null
        router.replace('/items', { scroll: false })
        return
      }
      const item = items.find((i) => i.id === id)
      if (!item) {
        if (items.length > 0) {
          toast.error('Item not found.')
          urlEditHydratedIdRef.current = null
          router.replace('/items', { scroll: false })
        }
        return
      }
      if (urlEditHydratedIdRef.current !== id) {
        urlEditHydratedIdRef.current = id
        populateEditorFromItem(item)
        setShowModal(true)
      }
      router.replace('/items', { scroll: false })
      return
    }

    urlEditHydratedIdRef.current = null

    if (wantNew) {
      if (!urlNewHydratedRef.current) {
        urlNewHydratedRef.current = true
        resetForm()
        setCreateItemCodeNonce((n) => n + 1)
        setShowModal(true)
      }
      router.replace('/items', { scroll: false })
      return
    }

    urlNewHydratedRef.current = false
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

  const isFeedItemForm = (formData.pos_category || '').toLowerCase() === 'feed'
  const isNonPosForm = (formData.pos_category || '').toLowerCase() === 'non_pos'

  const feedSellingPriceSuspicion = useMemo(() => {
    if (!isFeedItemForm) return null
    const up = parseMoneyField(formData.unit_price)
    const co = parseMoneyField(formData.cost)
    const kg =
      formData.content_weight_kg === '' || formData.content_weight_kg == null
        ? NaN
        : Number(formData.content_weight_kg)
    return feedSellingPriceSuspiciousMessage(up, co, kg)
  }, [isFeedItemForm, formData.unit_price, formData.cost, formData.content_weight_kg])

  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto app-scroll-pad">
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
              type="button"
              onClick={() => {
                router.replace('/items', { scroll: false })
                resetForm()
                setCreateItemCodeNonce((n) => n + 1)
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
              type="button"
              onClick={() => {
                router.replace('/items', { scroll: false })
                resetForm()
                setCreateItemCodeNonce((n) => n + 1)
                setShowModal(true)
              }}
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
                    <span className="text-gray-500">Report category:</span>
                    <span className="font-medium text-amber-800 text-right max-w-[55%] truncate" title={item.category || 'General'}>
                      {item.category || 'General'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Type:</span>
                    <span className="font-medium text-gray-900">
                      {item.item_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">
                      {(item.pos_category || '').toLowerCase() === 'feed'
                        ? 'Selling price (BDT per sack):'
                        : `Selling price (${item.unit || 'unit'}):`}
                    </span>
                    <span className="font-medium text-green-600">{currencySymbol}{formatNumber(Number(item.unit_price || 0))}</span>
                  </div>
                  {(item.pos_category || '').toLowerCase() === 'feed' &&
                    item.content_weight_kg != null &&
                    item.content_weight_kg !== '' &&
                    Number(item.content_weight_kg) > 0 && (
                      <div className="flex justify-between text-xs text-teal-800">
                        <span>Kg per sack (weight):</span>
                        <span className="font-medium tabular-nums">{Number(item.content_weight_kg)} kg</span>
                      </div>
                    )}
                  <div className="flex justify-between">
                    <span className="text-gray-500">
                      {(item.pos_category || '').toLowerCase() === 'feed'
                        ? 'Cost (BDT per sack):'
                        : 'Cost:'}
                    </span>
                    <span className="font-medium text-gray-900">{currencySymbol}{formatNumber(Number(item.cost || 0))}</span>
                  </div>
                  {(item.item_type.toUpperCase() === 'INVENTORY' || item.item_type.toLowerCase() === 'inventory') && (
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-gray-500 shrink-0">
                        {(item.pos_category || '').toLowerCase() === 'feed' ? 'Sacks on hand:' : 'On Hand:'}
                      </span>
                      <span className="font-medium text-gray-900 text-right">
                        {(item.pos_category || '').toLowerCase() === 'feed'
                          ? formatFeedSackQuantityLabel(parseInventoryQty(item.quantity_on_hand))
                          : `${formatNumber(parseInventoryQty(item.quantity_on_hand))} ${item.unit}`}
                        {feedApproxTotalKg(item) != null && (
                          <span className="block text-xs font-normal text-teal-700 mt-0.5">
                            ≈ {feedApproxTotalKg(item)!.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg
                            total
                          </span>
                        )}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end space-x-2 pt-4 border-t">
                  {itemHasPerStationShopStock(item) && (
                    <Link
                      href={`/inventory?tab=lookup&item_id=${item.id}`}
                      className="p-2 text-teal-600 hover:bg-teal-50 rounded"
                      title="Stock by station"
                    >
                      <ArrowRightLeft className="h-4 w-4" />
                    </Link>
                  )}
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
                    Report category
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Selling price
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
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-amber-900 max-w-[140px]">
                      <span className="line-clamp-2" title={item.category || 'General'}>
                        {item.category || 'General'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getItemColor(item.item_type)}`}>
                        {item.item_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-green-600">
                      <span className="block">{currencySymbol}{formatNumber(Number(item.unit_price || 0))}</span>
                      {(item.pos_category || '').toLowerCase() === 'feed' &&
                        item.content_weight_kg != null &&
                        item.content_weight_kg !== '' &&
                        Number(item.content_weight_kg) > 0 && (
                          <span className="block text-xs font-normal text-teal-800">
                            {Number(item.content_weight_kg)} kg per {item.unit || 'sack'}
                          </span>
                        )}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {currencySymbol}{formatNumber(Number(item.cost || 0))}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {(item.item_type.toUpperCase() === 'INVENTORY' || item.item_type.toLowerCase() === 'inventory') ? (
                        <span>
                          {(item.pos_category || '').toLowerCase() === 'feed'
                            ? formatFeedSackQuantityLabel(parseInventoryQty(item.quantity_on_hand))
                            : `${formatNumber(parseInventoryQty(item.quantity_on_hand))} ${item.unit}`}
                          {feedApproxTotalKg(item) != null && (
                            <span className="block text-xs text-teal-700 mt-0.5">
                              ≈ {feedApproxTotalKg(item)!.toLocaleString(undefined, { maximumFractionDigits: 2 })} kg
                            </span>
                          )}
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
                        {itemHasPerStationShopStock(item) && (
                          <Link
                            href={`/inventory?tab=lookup&item_id=${item.id}`}
                            className="p-2 text-teal-600 hover:bg-teal-50 rounded transition-colors"
                            title="Stock by station"
                          >
                            <ArrowRightLeft className="h-4 w-4" />
                          </Link>
                        )}
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
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black bg-opacity-50">
            <div className="bg-white rounded-lg app-modal-pad max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <h2 className="text-2xl font-bold mb-6">
                {editingId ? 'Edit Item' : 'Add New Item'}
              </h2>
              <form noValidate onSubmit={handleSubmit}>
                {editingId ? (
                  <ReferenceCodePicker
                    kind="item"
                    id="item_ref_ro"
                    label="Item number"
                    value={items.find((i) => i.id === editingId)?.item_number || ''}
                    onChange={() => {}}
                    disabled
                    className="mb-4"
                  />
                ) : (
                  <ReferenceCodePicker
                    key={createItemCodeNonce}
                    kind="item"
                    id="item_ref"
                    label="Item number"
                    value={itemRefCode}
                    onChange={setItemRefCode}
                    className="mb-4"
                  />
                )}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Item Name *
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
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
                      onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
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
                      onChange={(e) => setFormData((prev) => ({ ...prev, item_type: e.target.value as any }))}
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
                      onChange={(e) => setFormData((prev) => ({ ...prev, unit: e.target.value }))}
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
                      <option value="sack">Sack (25 kg, 20 kg, 10 kg… — set kg when POS = Feed)</option>
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
                      {isFeedItemForm
                        ? 'For sack-packed feed, choose Sack — stock and POS quantity are counted in sacks.'
                        : 'Select the unit of measure for this item'}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      POS Category
                    </label>
                    <select
                      value={formData.pos_category}
                      onChange={(e) => {
                        const v = e.target.value
                        setFormData((prev) => ({
                          ...prev,
                          pos_category: v,
                          ...(v === 'feed' && prev.unit === 'piece' ? { unit: 'sack' } : {}),
                          ...(v !== 'feed' ? { content_weight_kg: '' } : {}),
                          ...(v === 'non_pos' ? { is_pos_available: false } : {}),
                        }))
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="general">General (For POS General Items Tab)</option>
                      <option value="feed">Feed (sack sales — General POS tab)</option>
                      <option value="fuel">Fuel (For POS Fuel Tab - Linked to Tanks)</option>
                      <option value="service">Service</option>
                      <option value="other">Other</option>
                      <option value="non_pos">
                        Non-POS (aquaculture hatchery / pond stock — not shop or Cashier)
                      </option>
                    </select>
                    <p className="mt-1 text-xs text-gray-500">
                      General and feed items appear in the Cashier retail catalog. Fuel items use the Fuel tab and tanks.
                      Non-POS items are excluded from Cashier and per-station shop stock; use Aquaculture flows to move
                      stock (e.g. fish fry) into ponds.
                    </p>
                  </div>

                  {isFeedItemForm && (
                    <div className="col-span-2 rounded-lg border border-emerald-200 bg-emerald-50/60 p-4 space-y-3">
                      <h3 className="text-sm font-semibold text-emerald-900">Feed sack details</h3>
                      <p className="text-xs text-emerald-900/80">
                        You sell and count inventory in <strong>sacks</strong>. Each sack is labeled with how many kg it
                        contains (e.g. 25 kg, 10 kg). Enter that weight so stock can be read as sacks and as approximate
                        total kg. Use a <strong>separate item</strong> per sack size (e.g. one SKU for 25 kg sacks, another
                        for 10 kg) so price and stock stay correct.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <span className="text-xs text-emerald-950 self-center mr-1">Quick set kg/sack:</span>
                        {[10, 20, 25, 50].map((kg) => (
                          <button
                            key={kg}
                            type="button"
                            className="rounded-md border border-emerald-300 bg-white px-2.5 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100/80"
                            onClick={() =>
                              setFormData((prev) => ({
                                ...prev,
                                content_weight_kg: kg,
                                unit: prev.unit === 'piece' ? 'sack' : prev.unit,
                              }))
                            }
                          >
                            {kg} kg
                          </button>
                        ))}
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-emerald-950 mb-1">
                          Kg per sack (weight on label — not BDT) <span className="text-red-600">*</span>
                        </label>
                        <input
                          type="number"
                          required={isFeedItemForm}
                          min="0.001"
                          step="0.001"
                          autoComplete="off"
                          value={formData.content_weight_kg === '' ? '' : formData.content_weight_kg}
                          ref={contentWeightWheelRef}
                          onChange={(e) => {
                            const raw = e.target.value
                            if (raw === '') {
                              setFormData((f) => ({ ...f, content_weight_kg: '' }))
                              return
                            }
                            const n = parseFloat(raw)
                            setFormData((f) => ({
                              ...f,
                              content_weight_kg: Number.isFinite(n) ? n : '',
                            }))
                          }}
                          className="w-full max-w-xs px-3 py-2 border border-emerald-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white"
                          placeholder="e.g. 25"
                        />
                        <p className="mt-1 text-xs text-emerald-900/75">
                          Enter weight in kg (e.g. 25 or 20 for kg per sack). For very small packs (e.g. 10 g),
                          enter 0.01 (grams as kg).
                        </p>
                      </div>
                      {formData.item_type === 'inventory' &&
                        formData.content_weight_kg !== '' &&
                        Number(formData.content_weight_kg) > 0 && (
                          <p className="text-xs font-medium text-emerald-900">
                            At {formatFeedSackQuantityLabel(Number(formData.quantity_on_hand || 0))}, approx.{' '}
                            {(
                              Number(formData.quantity_on_hand || 0) * Number(formData.content_weight_kg)
                            ).toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
                            kg on hand.
                          </p>
                        )}
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="item-unit-price"
                      className="block text-sm font-medium text-gray-700 mb-2"
                    >
                      {isFeedItemForm ? (
                        <>Selling price (BDT per sack{feedSackPriceLabelSuffix(formData.content_weight_kg)}) *</>
                      ) : (
                        <>Selling price (BDT per {formData.unit || 'unit'}) *</>
                      )}
                    </label>
                    <input
                      key={`item-unit-price-${editingId ?? 'new'}`}
                      id="item-unit-price"
                      name="unit_price"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={formData.unit_price}
                      onChange={(e) => {
                        const v = normalizeMoneyTyping(e.target.value)
                        setFormData((prev) => ({ ...prev, unit_price: v }))
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                    {isFeedItemForm && (
                      <p className="mt-1 text-xs text-amber-800/90">
                        Enter the full sack price in BDT here (e.g. 1900). Sack weight in kg belongs only in the green
                        &quot;Kg per sack&quot; section above — not in this field.
                      </p>
                    )}
                    {feedSellingPriceSuspicion && (
                      <p
                        className="mt-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"
                        role="alert"
                      >
                        {feedSellingPriceSuspicion}
                      </p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="item-cost" className="block text-sm font-medium text-gray-700 mb-2">
                      {isFeedItemForm ? (
                        <>Cost (BDT per sack{feedSackPriceLabelSuffix(formData.content_weight_kg)}) *</>
                      ) : (
                        <>Cost (BDT per {formData.unit || 'unit'}) *</>
                      )}
                    </label>
                    <input
                      key={`item-cost-${editingId ?? 'new'}`}
                      id="item-cost"
                      name="cost"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={formData.cost}
                      onChange={(e) => {
                        const v = normalizeMoneyTyping(e.target.value)
                        setFormData((prev) => ({ ...prev, cost: v }))
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    />
                    {isFeedItemForm && (
                      <p className="mt-1 text-xs text-amber-800/90">
                        Enter BDT for one full sack of feed (same sack size as &quot;Kg per sack&quot; above).
                      </p>
                    )}
                  </div>

                  {formData.item_type === 'inventory' && (
                    <div className="space-y-2">
                      {shopStationRows.length > 1 && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            {isFeedItemForm
                              ? 'Shop location (sack count applies here)'
                              : 'Shop location (quantity applies here)'}
                          </label>
                          <select
                            value={selectedShopStationId ?? ''}
                            onChange={(e) => {
                              const sid = e.target.value ? parseInt(e.target.value, 10) : null
                              setSelectedShopStationId(sid)
                              const row = shopStationRows.find((r) => r.station_id === sid)
                              if (row) {
                                setFormData((prev) => ({
                                  ...prev,
                                  quantity_on_hand: row.quantity,
                                }))
                              }
                            }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
                          >
                            {shopStationRows.map((s) => (
                              <option key={s.station_id} value={s.station_id}>
                                {s.station_name} (on hand:{' '}
                                {isFeedItemForm
                                  ? formatFeedSackQuantityLabel(s.quantity)
                                  : s.quantity}
                                )
                              </option>
                            ))}
                          </select>
                          <p className="mt-1 text-xs text-gray-500">
                            This company has multiple active stations. Stock is saved for the location you select; total
                            on the item card is the sum across locations.
                          </p>
                        </div>
                      )}
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
                          {isFeedItemForm ? 'Sacks on hand' : 'Quantity on Hand'}
                        </label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          autoComplete="off"
                          value={formData.quantity_on_hand}
                          ref={qtyOnHandWheelRef}
                          onChange={(e) => {
                            const value = e.target.value === '' ? 0 : parseFloat(e.target.value)
                            setFormData((prev) => ({
                              ...prev,
                              quantity_on_hand: Number.isFinite(value) ? value : prev.quantity_on_hand,
                            }))
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
                            : shopStationRows.length > 1
                              ? `Quantity is for the shop location selected above (not the company-wide total).`
                              : isNonPosForm
                                ? `Company-level quantity for this SKU (not split across shop locations). Record pond movements in Aquaculture.`
                                : isFeedItemForm
                                  ? `Number of physical sacks at this location (10 kg, 25 kg, etc. depends on this item’s kg per sack). Total kg ≈ sacks × kg per sack.`
                                  : `Current quantity in ${formData.unit}`}
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="col-span-2 space-y-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Reporting category <span className="text-red-500">*</span>
                    </label>
                    <p className="text-xs text-gray-500 mb-2">
                      Used for business reports (by category and by item). This is separate from the POS tab (Fuel / General) above.
                      For hatchery fish fry and pond stock, use <strong className="font-medium">Aquaculture</strong> (or Fish buying and selling when appropriate).
                    </p>
                    <select
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
                      value=""
                      onChange={(e) => {
                        const v = e.target.value
                        if (v) setFormData((f) => ({ ...f, category: v }))
                      }}
                    >
                      <option value="">Apply a common category to the field below…</option>
                      {[...categoryPresets, ...categoryCustomInUse].map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      required
                      value={formData.category}
                      onChange={(e) => setFormData((prev) => ({ ...prev, category: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g. Poultry feed, General, Medicine — or pick from the list above"
                      list="item-reporting-categories"
                      autoComplete="off"
                    />
                    <datalist id="item-reporting-categories">
                      {Array.from(
                        new Set(
                          [
                            ...categoryPresets,
                            ...categoryCustomInUse,
                            formData.category,
                          ].filter((x): x is string => Boolean(x && x.trim()))
                        )
                      ).map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Barcode (Optional)
                    </label>
                    <input
                      type="text"
                      value={formData.barcode}
                      onChange={(e) => setFormData((prev) => ({ ...prev, barcode: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="Scan or enter barcode"
                    />
                  </div>

                  <div className="col-span-2">
                    <div className="flex items-center space-x-6">
                      <label className={`flex items-center space-x-2 ${isNonPosForm ? 'opacity-60' : ''}`}>
                        <input
                          type="checkbox"
                          checked={isNonPosForm ? false : formData.is_pos_available}
                          disabled={isNonPosForm}
                          onChange={(e) => setFormData((prev) => ({ ...prev, is_pos_available: e.target.checked }))}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm font-medium text-gray-700">Available in POS</span>
                      </label>
                      {isNonPosForm && (
                        <span className="text-xs text-gray-500">
                          Off for Non-POS (Cashier cannot sell this SKU).
                        </span>
                      )}
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={formData.is_taxable}
                          onChange={(e) => setFormData((prev) => ({ ...prev, is_taxable: e.target.checked }))}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-sm font-medium text-gray-700">Taxable</span>
                      </label>
                      <label className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={formData.is_active}
                          onChange={(e) => setFormData((prev) => ({ ...prev, is_active: e.target.checked }))}
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












