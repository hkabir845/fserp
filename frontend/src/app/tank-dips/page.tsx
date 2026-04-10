'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Droplet,
  TrendingUp,
  TrendingDown,
  Plus,
  AlertCircle,
  Edit,
  Trash2,
  RefreshCcw,
} from 'lucide-react'
import Sidebar from '@/components/Sidebar'
import api from '@/lib/api'
import { useCompany } from '@/contexts/CompanyContext'
import { safeLogError, isConnectionError } from '@/utils/connectionError'
import { formatCurrency } from '@/utils/currency'
import { formatDateOnly } from '@/utils/date'

/** Variance BDT uses item cost (৳/L) when set, else unit_price. */
const VARIANCE_CURRENCY = 'BDT'

function varianceRatePerLiter(product: Product | undefined): number {
  if (!product) return 0
  const c = Number(product.cost)
  if (Number.isFinite(c) && c > 0) return c
  return Number(product.unit_price) || 0
}

interface Tank {
  id: number
  tank_number: string
  tank_name: string
  station_id?: number
  station_name?: string
  product_id: number
  product_name?: string
  current_stock: number | string
  capacity: number | string
  is_active?: boolean
}

interface Product {
  id: number
  name: string
  unit_price: number
  /** ৳ per liter (or item UOM); preferred for variance BDT when set. */
  cost?: number
}

/** Matches Django `/tank-dips/` API (`volume`, `dip_date`, optional `tank_name`). */
interface TankDip {
  id: number
  tank_id: number
  tank_name?: string
  dip_date: string
  volume: string
  /** Book liters before this dip (snapshot for variance / audit). */
  book_stock_before?: string | null
  water_level?: string | null
  notes: string
  gl_journal_posted?: boolean
  gl_entry_number?: string | null
  gl_skip_reason?: string | null
  gl_journal_hint?: string | null
}

function dipMeasuredVolume(dip: TankDip): number {
  const v =
    dip.volume ??
    (dip as unknown as { measured_quantity?: number | string }).measured_quantity
  if (v === undefined || v === null || v === '') return 0
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : 0
}

function dipDateKey(dip: TankDip): string {
  const raw =
    dip.dip_date ??
    (dip as unknown as { reading_date?: string }).reading_date ??
    ''
  if (!raw) return ''
  return String(raw).split('T')[0]
}

/** Latest dip for a tank (by dip_date, then id) — matches server reconciliation ordering. */
function getLatestDipForTank(tankId: number, dipsList: TankDip[]): TankDip | null {
  const forTank = dipsList.filter((d) => d.tank_id === tankId)
  if (forTank.length === 0) return null
  return [...forTank].sort((a, b) => {
    const da = dipDateKey(a)
    const db = dipDateKey(b)
    if (da !== db) return db.localeCompare(da)
    return b.id - a.id
  })[0]
}

function asArray<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : []
}

export default function TankDipsPage() {
  const router = useRouter()
  const { selectedCompany } = useCompany()
  const [tanks, setTanks] = useState<Tank[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [dips, setDips] = useState<TankDip[]>([])
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editingDip, setEditingDip] = useState<TankDip | null>(null)
  const [showEditForm, setShowEditForm] = useState(false)

  // Form state
  const [selectedTank, setSelectedTank] = useState<number | null>(null)
  const [measuredQty, setMeasuredQty] = useState('')
  const [notes, setNotes] = useState('')
  /** When true, POST/PUT sends skip_variance_gl so no variance journal is posted. */
  const [skipVarianceGl, setSkipVarianceGl] = useState(false)

  // Edit form state
  const [editMeasuredQty, setEditMeasuredQty] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editDipDate, setEditDipDate] = useState('')
  const [syncingBook, setSyncingBook] = useState(false)
  const [resyncingGl, setResyncingGl] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const settled = await Promise.allSettled([
      api.get('/tanks/'),
      api.get('/items/'),
      api.get('/tank-dips/'),
    ])

    const [tanksResult, productsResult, dipsResult] = settled

    const tankList =
      tanksResult.status === 'fulfilled' ? asArray<Tank>(tanksResult.value.data) : []
    const productList =
      productsResult.status === 'fulfilled' ? asArray<Product>(productsResult.value.data) : []
    const dipList =
      dipsResult.status === 'fulfilled' ? asArray<TankDip>(dipsResult.value.data) : []

    setTanks(tankList)
    setProducts(productList)
    setDips(dipList)

    const errs: string[] = []
    if (tanksResult.status === 'rejected') {
      const e = tanksResult.reason as { response?: { data?: { detail?: string }; status?: number } }
      const msg = e?.response?.data?.detail || 'Could not load tanks'
      errs.push(msg)
      if (!isConnectionError(tanksResult.reason)) safeLogError('[tank-dips] tanks', tanksResult.reason)
    }
    if (productsResult.status === 'rejected') {
      if (!isConnectionError(productsResult.reason)) safeLogError('[tank-dips] items', productsResult.reason)
      errs.push('Products list failed — variance in BDT uses price 0 until items load.')
    }
    if (dipsResult.status === 'rejected') {
      if (!isConnectionError(dipsResult.reason)) safeLogError('[tank-dips] dips', dipsResult.reason)
      errs.push('Could not load dip history.')
    }

    if (errs.length) {
      setLoadError(errs.join(' '))
    }

    setLoading(false)
  }, [])

  /** Prefer active tanks; if none pass the filter, still list all tanks so the dropdown works. */
  const tanksForDipSelect = useMemo(() => {
    const active = tanks.filter((t) => t.is_active !== false)
    return active.length > 0 ? active : tanks
  }, [tanks])

  const dipsSorted = useMemo(() => {
    return [...dips].sort((a, b) => {
      const da = dipDateKey(a)
      const db = dipDateKey(b)
      if (da !== db) return db.localeCompare(da)
      return b.id - a.id
    })
  }, [dips])

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null
    if (!token) {
      router.push('/login')
      return
    }
    loadData()
  }, [router, loadData, selectedCompany?.id])

  useEffect(() => {
    if (!showForm) return
    setSelectedTank((prev) => {
      if (prev == null) return null
      return tanksForDipSelect.some((t) => t.id === prev) ? prev : null
    })
  }, [showForm, tanksForDipSelect])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!selectedTank || !measuredQty) {
      alert('Please fill all required fields')
      return
    }

    const measuredQuantity = parseFloat(measuredQty)
    if (isNaN(measuredQuantity) || measuredQuantity < 0) {
      alert('Please enter a valid measured quantity')
      return
    }

    try {
      const { data } = await api.post<{
        gl_variance?: { status: string; reason?: string }
        gl_journal_posted?: boolean
        gl_journal_hint?: string | null
      }>('/tank-dips/', {
        tank_id: selectedTank,
        volume: measuredQuantity,
        notes: notes || '',
        ...(skipVarianceGl ? { skip_variance_gl: true } : {}),
      })

      let glNote = ''
      if (!skipVarianceGl && data?.gl_variance?.status === 'skipped' && data.gl_variance.reason) {
        glNote = `\n\nVariance journal: not posted (${data.gl_variance.reason}). ${data.gl_journal_hint ?? ''}`.trim()
      } else if (!skipVarianceGl && data?.gl_journal_posted) {
        glNote = '\n\nVariance journal posted to the general ledger (wet-stock inventory vs COGS / shrinkage).'
      }

      alert(
        'Tank dip recorded successfully. Book stock for this tank is updated to the measured volume (latest dip reconciliation).' +
          glNote
      )
      setShowForm(false)
      setSelectedTank(null)
      setMeasuredQty('')
      setNotes('')
      setSkipVarianceGl(false)
      loadData()
    } catch (error: any) {
      alert(error.response?.data?.detail || 'Error recording tank dip')
    }
  }

  const getProductName = (productId: number, tank?: Tank) => {
    if (tank?.product_name) return tank.product_name
    const product = products.find((p) => p.id === productId)
    return product?.name || 'Unknown'
  }

  const getFillPercentage = (tank: Tank) => {
    const stock = Number(tank.current_stock ?? 0)
    const cap = Number(tank.capacity ?? 0)
    if (!cap || cap <= 0) return '0.0'
    return ((stock / cap) * 100).toFixed(1)
  }

  const handleEdit = (dip: TankDip) => {
    setSkipVarianceGl(false)
    setEditingDip(dip)
    setEditMeasuredQty(
      dip.volume != null && dip.volume !== ''
        ? String(dip.volume)
        : String(dipMeasuredVolume(dip) || '')
    )
    setEditNotes(dip.notes || '')
    setEditDipDate(dipDateKey(dip) || new Date().toISOString().split('T')[0])
    setShowEditForm(true)
  }

  const handleDelete = async (dipId: number) => {
    if (!confirm('Are you sure you want to delete this dip reading? This action cannot be undone.')) {
      return
    }

    try {
      await api.delete(`/tank-dips/${dipId}/`)
      alert('Tank dip deleted successfully!')
      loadData()
    } catch (error: any) {
      alert(error.response?.data?.detail || 'Error deleting tank dip')
    }
  }

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!editingDip || !editMeasuredQty) {
      alert('Please fill all required fields')
      return
    }

    const measuredQuantity = parseFloat(editMeasuredQty)
    if (isNaN(measuredQuantity) || measuredQuantity < 0) {
      alert('Please enter a valid measured quantity')
      return
    }

    try {
      const updateData: { volume: number; dip_date?: string; notes: string } = {
        volume: measuredQuantity,
        notes: editNotes || '',
      }

      if (editDipDate) {
        updateData.dip_date = editDipDate
      }

      const { data } = await api.put<{
        gl_variance?: { status: string; reason?: string }
        gl_journal_posted?: boolean
        gl_journal_hint?: string | null
      }>(`/tank-dips/${editingDip.id}/`, {
        ...updateData,
        ...(skipVarianceGl ? { skip_variance_gl: true } : {}),
      })

      let glNote = ''
      if (!skipVarianceGl && data?.gl_variance?.status === 'skipped' && data.gl_variance.reason) {
        glNote = `\n\nVariance journal: not posted (${data.gl_variance.reason}). ${data.gl_journal_hint ?? ''}`.trim()
      } else if (!skipVarianceGl && data?.gl_journal_posted) {
        glNote = '\n\nVariance journal synced to the general ledger.'
      }

      alert(
        'Tank dip updated. If this is the latest dip for the tank, book stock is reconciled to the new measured volume.' +
          glNote
      )
      setShowEditForm(false)
      setEditingDip(null)
      setEditMeasuredQty('')
      setEditNotes('')
      setEditDipDate('')
      setSkipVarianceGl(false)
      loadData()
    } catch (error: any) {
      alert(error.response?.data?.detail || 'Error updating tank dip')
    }
  }

  const cancelEdit = () => {
    setShowEditForm(false)
    setEditingDip(null)
    setEditMeasuredQty('')
    setEditNotes('')
    setSkipVarianceGl(false)
    setEditDipDate('')
  }

  /** One-shot: set every tank’s book stock to its latest dip (same rule as saving a new latest dip). */
  const handleSyncBookToLatestDips = async () => {
    if (
      !confirm(
        'Set each tank’s book stock to its latest saved dip reading? Use after entering historical dips or if book drifted. POS sales and stock receipts will still move book after this.'
      )
    ) {
      return
    }
    setSyncingBook(true)
    try {
      const { data } = await api.post<{
        ok?: boolean
        tanks_synced?: number
        results?: { tank_id: number; tank_name: string; book_liters: string; dip_date: string }[]
      }>('/tank-dips/reconcile-all/')
      const n = data?.tanks_synced ?? data?.results?.length ?? 0
      alert(
        n > 0
          ? `Book stock aligned for ${n} tank(s) with dip history. Cards and dropdowns use this book until sales or deliveries change it.`
          : 'No tanks have dip readings yet — record dips first, then sync if needed.'
      )
      loadData()
    } catch (error: unknown) {
      const e = error as { response?: { data?: { detail?: string } } }
      alert(e.response?.data?.detail || 'Could not sync book to latest dips')
    } finally {
      setSyncingBook(false)
    }
  }

  /** Re-post every dip variance journal at current product cost (e.g. after Liter + cost fix). */
  const handleResyncAllVarianceGl = async () => {
    if (
      !confirm(
        'Re-post variance GL for all saved dips? Each AUTO-TANKDIP-{id}-VAR entry is replaced using current item cost (or unit price). Fuel inventory (1200) and COGS/shrinkage amounts update accordingly. Dips with no variance or no cost still skip.'
      )
    ) {
      return
    }
    setResyncingGl(true)
    try {
      const { data } = await api.post<{
        ok?: boolean
        dips_processed?: number
        posted?: number
        skipped?: number
        skipped_by_reason?: Record<string, number>
      }>('/tank-dips/sync-variance-gl-all/')
      const p = data?.posted ?? 0
      const s = data?.skipped ?? 0
      const reasons = data?.skipped_by_reason
      const reasonLines = reasons
        ? Object.entries(reasons)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => `${k}: ${v}`)
            .join('\n')
        : ''
      alert(
        `Variance GL re-sync complete.\nPosted: ${p}\nSkipped: ${s}${
          reasonLines ? `\n\nSkipped breakdown:\n${reasonLines}` : ''
        }`
      )
      loadData()
    } catch (error: unknown) {
      const e = error as { response?: { data?: { detail?: string } } }
      alert(e.response?.data?.detail || 'Could not re-sync variance journals')
    } finally {
      setResyncingGl(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen bg-gray-100 page-with-sidebar">
        <Sidebar />
        <div className="flex-1 overflow-auto p-8">
          <div className="text-center">Loading...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-gray-100 page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto p-8">
        <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Tank Dip Readings</h1>
            <p className="text-gray-600">Stock Reconciliation & Gain/Loss Tracking</p>
            {selectedCompany?.name && (
              <p className="text-sm text-gray-500 mt-1">Company: {selectedCompany.name}</p>
            )}
            {dipsSorted.length > 0 && (
              <p className="text-sm text-gray-700 mt-2">
                <span className="font-semibold text-indigo-800">{dipsSorted.length}</span> dip reading
                {dipsSorted.length === 1 ? '' : 's'} on file — shown in{' '}
                <a href="#dip-history-summary" className="text-indigo-600 underline font-medium">
                  summary
                </a>{' '}
                and{' '}
                <a href="#dip-readings-detail-table" className="text-indigo-600 underline font-medium">
                  full table
                </a>
                . (Dips are stick readings, not POS sales.)
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => loadData()}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 text-sm font-medium"
            >
              Refresh
            </button>
            <button
              type="button"
              onClick={handleSyncBookToLatestDips}
              disabled={syncingBook || dipsSorted.length === 0}
              title={
                dipsSorted.length === 0
                  ? 'Record at least one dip before syncing book'
                  : 'Set book stock on every tank to its latest dip reading'
              }
              className="px-4 py-2 border border-slate-300 rounded-lg text-slate-800 hover:bg-slate-50 text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCcw className={`h-4 w-4 ${syncingBook ? 'animate-spin' : ''}`} />
              {syncingBook ? 'Syncing…' : 'Sync book to latest dips'}
            </button>
            <button
              type="button"
              onClick={handleResyncAllVarianceGl}
              disabled={resyncingGl || dipsSorted.length === 0}
              title={
                dipsSorted.length === 0
                  ? 'Record dips first'
                  : 'Re-post all dip variance journals using current Diesel/Petrol cost (inventory 1200)'
              }
              className="px-4 py-2 border border-indigo-300 rounded-lg text-indigo-900 hover:bg-indigo-50 text-sm font-medium inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCcw className={`h-4 w-4 ${resyncingGl ? 'animate-spin' : ''}`} />
              {resyncingGl ? 'Re-posting GL…' : 'Re-post all dip variance GL'}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!showForm) setSkipVarianceGl(false)
                setShowForm(!showForm)
              }}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 flex items-center space-x-2"
            >
              <Plus className="h-5 w-5" />
              <span>Record Dip</span>
            </button>
          </div>
        </div>

        {loadError && (
          <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {loadError}
          </div>
        )}

        {dipsSorted.length > 0 && (
          <div
            id="dip-history-summary"
            className="mb-6 rounded-xl border-2 border-indigo-200 bg-gradient-to-b from-indigo-50 to-white p-5 shadow-sm scroll-mt-4"
          >
            <h2 className="text-lg font-bold text-indigo-950">Your recorded dip readings</h2>
            <p className="text-sm text-indigo-900/80 mt-1 mb-4">
              These are the physical tank measurements you saved. The detailed variance columns are in the{' '}
              <a href="#dip-readings-detail-table" className="underline font-medium">
                full table
              </a>{' '}
              (scroll down or use the link).
            </p>
            <ul className="rounded-lg border border-indigo-100 bg-white divide-y divide-slate-100">
              {dipsSorted.map((dip) => {
                const tank = tanks.find((t) => t.id === dip.tank_id)
                const dk = dipDateKey(dip)
                return (
                  <li
                    key={dip.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm"
                  >
                    <div>
                      <span className="font-semibold text-slate-900">
                        {dip.tank_name || tank?.tank_name || `Tank #${dip.tank_id}`}
                      </span>
                      <span className="text-slate-500 mx-2">·</span>
                      <span className="text-slate-600">
                        {dk ? formatDateOnly(dk) : '—'}
                      </span>
                    </div>
                    <div className="tabular-nums font-medium text-indigo-800">
                      {dipMeasuredVolume(dip).toFixed(2)} L measured
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

      {/* New Dip Form */}
      {showForm && (
        <div className="bg-blue-50 border-2 border-blue-500 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-bold text-blue-900 mb-4">Record Tank Dip Reading</h2>
          <form onSubmit={handleSubmit}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tank *
                </label>
                <select
                  name="tank_id"
                  aria-label="Tank for dip reading"
                  value={selectedTank != null ? String(selectedTank) : ''}
                  onChange={(e) => {
                    const v = e.target.value
                    if (v === '') {
                      setSelectedTank(null)
                      return
                    }
                    const id = Number(v)
                    setSelectedTank(Number.isFinite(id) ? id : null)
                  }}
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900 relative z-10 appearance-auto"
                  required
                  disabled={tanksForDipSelect.length === 0}
                >
                  <option value="">
                    {tanksForDipSelect.length === 0
                      ? 'No tanks — add tanks under Inventory → Tanks'
                      : 'Select tank…'}
                  </option>
                  {tanksForDipSelect.map((tank) => (
                    <option key={tank.id} value={String(tank.id)}>
                      {tank.tank_name}
                      {tank.is_active === false ? ' (inactive)' : ''}
                      {tank.station_name ? ` · ${tank.station_name}` : ''} — book{' '}
                      {Number(tank.current_stock ?? 0).toFixed(2)} L ({getProductName(tank.product_id, tank)})
                    </option>
                  ))}
                </select>
                {tanks.length > 0 &&
                  tanks.every((t) => t.is_active === false) &&
                  tanksForDipSelect.length > 0 && (
                    <p className="text-xs text-amber-700 mt-1">
                      All tanks are marked inactive; showing them anyway so you can still record a dip. Activate tanks
                      in Inventory when possible.
                    </p>
                  )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Measured Quantity (Liters) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={measuredQty}
                  onChange={(e) => setMeasuredQty(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                  required
                />
              </div>
            </div>

            {selectedTank && measuredQty && (
              <div className="bg-white rounded-lg p-4 mb-4">
                <h3 className="font-bold text-gray-900 mb-2">Variance Preview</h3>
                {(() => {
                  const tank = tanks.find(t => t.id === selectedTank)
                  if (!tank) return null

                  const systemQty = Number(tank.current_stock || 0)
                  const measured = parseFloat(measuredQty) || 0
                  const variance = measured - systemQty
                  const product = products.find(p => p.id === tank.product_id)
                  const varianceValue = variance * varianceRatePerLiter(product)

                  return (
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <div className="text-sm text-gray-600">System Stock</div>
                        <div className="text-xl font-bold text-gray-900">
                          {Number(systemQty || 0).toFixed(2)} L
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-600">Measured Stock</div>
                        <div className="text-xl font-bold text-blue-600">
                          {Number(measured || 0).toFixed(2)} L
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-600">Variance</div>
                        <div className={`text-xl font-bold flex items-center justify-center ${
                          variance >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {variance >= 0 ? <TrendingUp className="h-5 w-5 mr-1" /> : <TrendingDown className="h-5 w-5 mr-1" />}
                          {Math.abs(Number(variance || 0)).toFixed(2)} L
                        </div>
                        <div className={`text-sm ${variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatCurrency(Math.abs(Number(varianceValue || 0)), VARIANCE_CURRENCY)}{' '}
                          {variance >= 0 ? 'GAIN' : 'LOSS'}
                        </div>
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Notes (Optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Any observations..."
              />
            </div>

            {selectedTank != null &&
              (() => {
                const t = tanks.find((x) => x.id === selectedTank)
                const p = t ? products.find((x) => x.id === t.product_id) : undefined
                if (p && varianceRatePerLiter(p) > 0) return null
                return (
                  <p className="text-xs text-amber-800 mb-3">
                    Item has no cost (and no unit price): variance reports show ৳0 until you set cost on the product or
                    run <code className="bg-amber-100 px-1 rounded">backfill_tank_product_costs</code>.
                  </p>
                )
              })()}

            <label className="flex items-start gap-2 mb-4 text-sm text-gray-800 cursor-pointer">
              <input
                type="checkbox"
                checked={skipVarianceGl}
                onChange={(e) => setSkipVarianceGl(e.target.checked)}
                className="mt-1 rounded border-gray-300"
              />
              <span>
                Skip GL posting for this dip (no variance journal). Use for corrections or backfill; reports still use
                cost for BDT when you refresh.
              </span>
            </label>

            <div className="flex space-x-3">
              <button
                type="submit"
                disabled={tanksForDipSelect.length === 0 || selectedTank == null}
                className="flex-1 bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                Record Dip
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-6 py-3 border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Current Tank Status — book stock reconciles to latest dip (server-side) */}
      <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
        <p className="font-medium text-slate-800">Book stock, physical dips, and movement</p>
        <p className="mt-1 text-slate-600">
          <strong>Book stock</strong> is what the ERP uses for tank cards, the dip form, and (with your POS setup)
          sales and deliveries — it goes down on fuel sales and up on receipts. <strong>Dip readings</strong> are the
          physical stick measurements; saving a dip as the <strong>latest</strong> for that tank sets book to that
          volume. If you entered dips out of order or book never caught up, use{' '}
          <strong>Sync book to latest dips</strong> to realign every tank to its newest saved reading. After that,
          normal transactions move book again; the next dip reconciles physical vs book and records variance from the
          snapshot (<strong>Book at dip</strong> in the table).
        </p>
        <p className="mt-3 text-slate-600 border-t border-slate-200 pt-3">
          <strong className="text-slate-800">Accounting (all tanks / products)</strong>: Fuel in tanks is{' '}
          <strong>inventory (balance-sheet asset</strong>, chart 1200 — wet stock at cost). A dip does not record a
          sale; it only measures what is already on hand. When measured liters differ from book at the dip time, the
          system posts a <strong>variance journal</strong>: gains <strong>debit inventory</strong> and{' '}
          <strong>credit COGS</strong> (reduces expense); losses <strong>debit shrinkage / COGS</strong> and{' '}
          <strong>credit inventory</strong>. The BDT amount is variance liters × the tank product&apos;s cost (or unit
          price if cost is unset). Diesel, petrol, octane, etc. all use the same wet-stock accounts so behavior matches
          across tanks.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
        {tanks.map((tank) => {
          const book = Number(tank.current_stock ?? 0)
          const latest = getLatestDipForTank(tank.id, dips)
          const latestVol = latest ? dipMeasuredVolume(latest) : null
          const reconciled =
            latestVol != null && Math.abs(latestVol - book) < 0.005
          return (
            <div key={tank.id} className="bg-white rounded-lg shadow p-6 border border-slate-100">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-bold text-gray-900">{tank.tank_name}</h3>
                  <p className="text-sm text-gray-600">{getProductName(tank.product_id, tank)}</p>
                </div>
                <Droplet
                  className={`h-6 w-6 ${
                    Number(getFillPercentage(tank)) > 50
                      ? 'text-blue-500'
                      : Number(getFillPercentage(tank)) > 20
                        ? 'text-yellow-500'
                        : 'text-red-500'
                  }`}
                />
              </div>
              <div className="mb-3">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Fill level (book)</span>
                  <span className="font-bold">{getFillPercentage(tank)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full ${
                      Number(getFillPercentage(tank)) > 50
                        ? 'bg-blue-500'
                        : Number(getFillPercentage(tank)) > 20
                          ? 'bg-yellow-500'
                          : 'bg-red-500'
                    }`}
                    style={{ width: `${Math.min(100, Number(getFillPercentage(tank)))}%` }}
                  />
                </div>
              </div>
              <div className="text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-600">Book stock</span>
                  <span className="font-semibold text-gray-900 tabular-nums">{book.toFixed(2)} L</span>
                </div>
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Capacity</span>
                  <span className="tabular-nums">{Number(tank.capacity ?? 0).toFixed(2)} L</span>
                </div>
                {latest ? (
                  <div
                    className={`mt-2 rounded-md px-2 py-1.5 text-xs ${
                      reconciled ? 'bg-emerald-50 text-emerald-900 border border-emerald-100' : 'bg-amber-50 text-amber-900 border border-amber-100'
                    }`}
                  >
                    <span className="font-medium">Latest dip</span>{' '}
                    <span className="tabular-nums">{latestVol!.toFixed(2)} L</span>
                    {dipDateKey(latest) && (
                      <>
                        {' '}
                        ·{' '}
                        {formatDateOnly(dipDateKey(latest))}
                      </>
                    )}
                    {reconciled ? (
                      <span className="block mt-0.5 text-emerald-800">Matches book — card reflects this reading.</span>
                    ) : (
                      <span className="block mt-0.5 text-amber-800">
                        Differs from book — try Refresh, or use &quot;Sync book to latest dips&quot; if dips are
                        correct. Sales/receipts after the dip also change book while the stick reading stays until the
                        next dip.
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-gray-500 pt-1">No dip recorded yet — book is system stock only.</p>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Edit Dip Form */}
      {showEditForm && editingDip && (
        <div className="bg-yellow-50 border-2 border-yellow-500 rounded-lg p-6 mb-6">
          <h2 className="text-xl font-bold text-yellow-900 mb-4">Edit Tank Dip Reading</h2>
          <form onSubmit={handleUpdate}>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tank (Read-only)
                </label>
                <input
                  type="text"
                  value={tanks.find(t => t.id === editingDip.tank_id)?.tank_name || 'Unknown'}
                  disabled
                  className="w-full px-4 py-2 border rounded-lg bg-gray-100 text-gray-600 cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Measured Quantity (Liters) *
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={editMeasuredQty}
                  onChange={(e) => setEditMeasuredQty(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
                  placeholder="0.00"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Dip date *
                </label>
                <input
                  type="date"
                  value={editDipDate}
                  onChange={(e) => setEditDipDate(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
                  required
                />
              </div>
            </div>

            {editMeasuredQty && editingDip && (
              <div className="bg-white rounded-lg p-4 mb-4">
                <h3 className="font-bold text-gray-900 mb-2">Variance Preview</h3>
                {(() => {
                  const tank = tanks.find((t) => t.id === editingDip.tank_id)
                  const systemQty =
                    editingDip.book_stock_before != null && editingDip.book_stock_before !== ''
                      ? Number(editingDip.book_stock_before)
                      : Number(tank?.current_stock ?? 0)
                  const measured = parseFloat(editMeasuredQty) || 0
                  const variance = measured - systemQty
                  const product = products.find((p) => p.id === tank?.product_id)
                  const varianceValue = variance * varianceRatePerLiter(product)

                  return (
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <div className="text-sm text-gray-600">System Stock</div>
                        <div className="text-xl font-bold text-gray-900">
                          {Number(systemQty || 0).toFixed(2)} L
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-600">Measured Stock</div>
                        <div className="text-xl font-bold text-blue-600">
                          {Number(measured || 0).toFixed(2)} L
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-600">Variance</div>
                        <div className={`text-xl font-bold flex items-center justify-center ${
                          variance >= 0 ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {variance >= 0 ? <TrendingUp className="h-5 w-5 mr-1" /> : <TrendingDown className="h-5 w-5 mr-1" />}
                          {Math.abs(Number(variance || 0)).toFixed(2)} L
                        </div>
                        <div className={`text-sm ${variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {formatCurrency(Math.abs(Number(varianceValue || 0)), VARIANCE_CURRENCY)}{' '}
                          {variance >= 0 ? 'GAIN' : 'LOSS'}
                        </div>
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Notes (Optional)
              </label>
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={3}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-yellow-500"
                placeholder="Any observations..."
              />
            </div>

            <label className="flex items-start gap-2 mb-4 text-sm text-gray-800 cursor-pointer">
              <input
                type="checkbox"
                checked={skipVarianceGl}
                onChange={(e) => setSkipVarianceGl(e.target.checked)}
                className="mt-1 rounded border-gray-300"
              />
              <span>
                Skip GL posting for this save (no variance journal). Touch-save old rows without GL, or leave unchecked
                to post.
              </span>
            </label>

            <div className="flex space-x-3">
              <button
                type="submit"
                className="flex-1 bg-yellow-600 text-white px-6 py-3 rounded-lg hover:bg-yellow-700"
              >
                Update Dip
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                className="px-6 py-3 border rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Full dip history table — variance & actions */}
      <div
        id="dip-readings-detail-table"
        className="bg-white rounded-lg shadow overflow-hidden scroll-mt-4"
      >
        <div className="px-6 py-4 border-b">
          <h2 className="text-xl font-bold text-gray-900">
            Dip readings — detail ({dipsSorted.length})
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            <strong>Book (at dip)</strong> is the system stock captured when the dip was saved. Variance is measured
            minus that snapshot, so gains/losses stay visible after book is reconciled to the stick reading.{' '}
            <strong>Value (BDT)</strong> is variance liters × the fuel item&apos;s cost (৳/L) when set, else unit
            price, in Bangladesh Taka (৳).
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tank</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Book (at dip)</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Measured</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Variance</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Value (BDT)</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase max-w-[14rem]">
                  GL journal
                </th>
                <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {dipsSorted.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-8 text-center text-gray-500">
                    <AlertCircle className="h-12 w-12 mx-auto mb-2 text-gray-400" />
                    <p>No dip readings recorded yet</p>
                    <p className="text-sm">Click &quot;Record Dip&quot; to add your first reading</p>
                  </td>
                </tr>
              ) : (
                dipsSorted.map((dip) => {
                  const tank = tanks.find((t) => t.id === dip.tank_id)
                  const measured = dipMeasuredVolume(dip)
                  const systemAtDip =
                    dip.book_stock_before != null && dip.book_stock_before !== ''
                      ? Number(dip.book_stock_before)
                      : Number(tank?.current_stock ?? 0)
                  const variance = measured - systemAtDip
                  const varianceType = variance >= 0 ? 'GAIN' : 'LOSS'
                  const product = products.find((p) => p.id === tank?.product_id)
                  const varianceValue = variance * varianceRatePerLiter(product)
                  const dateLabel = dipDateKey(dip)
                  const posted = dip.gl_journal_posted === true
                  return (
                    <tr key={dip.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {dateLabel
                          ? formatDateOnly(dateLabel)
                          : '—'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {dip.tank_name || tank?.tank_name || 'Unknown'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-600">
                        {systemAtDip.toFixed(2)} L
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium text-blue-600">
                        {measured.toFixed(2)} L
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                        <span
                          className={`font-medium flex items-center justify-end ${
                            varianceType === 'GAIN' ? 'text-green-600' : 'text-red-600'
                          }`}
                        >
                          {varianceType === 'GAIN' ? (
                            <TrendingUp className="h-4 w-4 mr-1" />
                          ) : (
                            <TrendingDown className="h-4 w-4 mr-1" />
                          )}
                          {Math.abs(variance).toFixed(2)} L
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-right">
                        <span
                          className={`font-medium ${
                            varianceType === 'GAIN' ? 'text-green-600' : 'text-red-600'
                          }`}
                        >
                          {formatCurrency(Math.abs(varianceValue), VARIANCE_CURRENCY)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-bold ${
                            varianceType === 'GAIN'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {varianceType}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-gray-700 max-w-[14rem]">
                        {posted ? (
                          <span className="text-emerald-800 font-medium" title={dip.gl_entry_number ?? undefined}>
                            Posted
                            {dip.gl_entry_number ? (
                              <span className="block text-[10px] text-gray-500 font-normal truncate">
                                {dip.gl_entry_number}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-gray-600" title={dip.gl_journal_hint ?? dip.gl_skip_reason ?? ''}>
                            Not posted
                            {dip.gl_skip_reason ? (
                              <span className="block text-[11px] text-amber-800 mt-0.5">
                                {dip.gl_journal_hint ?? dip.gl_skip_reason}
                              </span>
                            ) : null}
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <div className="flex items-center justify-center space-x-2">
                          <button
                            type="button"
                            onClick={() => handleEdit(dip)}
                            disabled={posted}
                            className={`p-2 rounded transition-colors ${
                              posted ? 'text-gray-400 cursor-not-allowed' : 'text-blue-600 hover:bg-blue-50'
                            }`}
                            title={posted ? 'Cannot edit: GL entry already posted' : 'Edit dip'}
                          >
                            <Edit className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(dip.id)}
                            disabled={posted}
                            className={`p-2 rounded transition-colors ${
                              posted ? 'text-gray-400 cursor-not-allowed' : 'text-red-600 hover:bg-red-50'
                            }`}
                            title={posted ? 'Cannot delete: GL entry already posted' : 'Delete dip'}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>
    </div>
  )
}

