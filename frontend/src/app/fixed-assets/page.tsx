'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import {
  Plus,
  Edit2,
  Trash2,
  X,
  PlayCircle,
  TrendingDown,
  Calendar,
  RefreshCw,
  RotateCcw,
  ExternalLink,
  Trash,
  Boxes,
} from 'lucide-react'
import Link from 'next/link'
import { useToast } from '@/components/Toast'
import { extractErrorMessage } from '@/utils/errorHandler'
import api from '@/lib/api'
import { formatCurrency } from '@/utils/currency'
import { formatDateOnly } from '@/utils/date'
import {
  COA_ACCUM_DEPR,
  COA_DEPR_EXPENSE,
  COA_FIXED_EQUIPMENT,
  suggestedFixedAssetAccountIds,
  templateCoaOptionLabel,
  type CoaPick,
} from '@/lib/coaDefaults'
import { formatCoaOptionLabel } from '@/utils/coaOptionLabel'

interface Station {
  id: number
  station_name: string
  is_active: boolean
}

interface Pond {
  id: number
  name: string
  is_active: boolean
}

interface DepreciationRun {
  id: number
  run_date: string
  amount: string
  journal_entry_id?: number | null
  reversal_journal_entry_id?: number | null
  reversed_at?: string | null
  memo?: string
}

interface ScheduleRow {
  period_index: number
  run_date: string
  amount: string
  book_value_before: string
  book_value_after: string
}

interface FixedAsset {
  id: number
  asset_number: string
  name: string
  description?: string
  status: string
  station_id?: number | null
  station_name?: string | null
  aquaculture_pond_id?: number | null
  pond_name?: string | null
  asset_account_id: number
  accumulated_depreciation_account_id: number
  depreciation_expense_account_id: number
  settlement_account_id?: number | null
  acquisition_date?: string | null
  in_service_date?: string | null
  acquisition_cost: string
  salvage_value: string
  useful_life_months: number
  opening_accumulated_depreciation: string
  accumulated_depreciation: string
  depreciable_base?: string
  book_value: string
  depreciable_remaining: string
  standard_monthly_depreciation: string
  next_depreciation_amount: string
  company_wide?: boolean
  cost_center_label?: string
  last_depreciation_date?: string | null
  acquisition_journal_entry_id?: number | null
  disposal_journal_entry_id?: number | null
  disposal_date?: string | null
  memo?: string
  depreciation_runs?: DepreciationRun[]
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  fully_depreciated: 'Fully depreciated',
  disposed: 'Disposed',
}

type CostCenterType = 'station' | 'pond' | 'head_office'

const emptyForm = () => ({
  name: '',
  description: '',
  cost_center_type: 'station' as CostCenterType,
  station_id: '',
  aquaculture_pond_id: '',
  asset_account_id: '',
  accumulated_depreciation_account_id: '',
  depreciation_expense_account_id: '',
  settlement_account_id: '',
  acquisition_date: new Date().toISOString().split('T')[0],
  in_service_date: new Date().toISOString().split('T')[0],
  acquisition_cost: '',
  salvage_value: '0',
  useful_life_months: '60',
  opening_accumulated_depreciation: '0',
  memo: '',
})

function monthsElapsedSince(startIso: string, endIso: string): number {
  if (!startIso?.trim() || !endIso?.trim()) return 0
  const start = new Date(startIso.split('T')[0])
  const end = new Date(endIso.split('T')[0])
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0
  return Math.max(0, (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()))
}

type AssetFormData = ReturnType<typeof emptyForm>

function computeSuggestedOpeningAccum(form: AssetFormData, asOfDate?: string): string {
  const cost = parseFloat(form.acquisition_cost) || 0
  const salvage = parseFloat(form.salvage_value) || 0
  const lifeMonths = parseInt(form.useful_life_months, 10) || 0
  if (cost <= 0 || lifeMonths <= 0) return '0'
  // New purchase capitalized via settlement → no prior depreciation in FSERP.
  if (form.settlement_account_id) return '0'
  const depreciable = Math.max(cost - salvage, 0)
  if (depreciable <= 0) return '0'
  const monthly = depreciable / lifeMonths
  const inService = form.in_service_date || form.acquisition_date
  const asOf = asOfDate || new Date().toISOString().split('T')[0]
  const elapsed = monthsElapsedSince(inService, asOf)
  if (elapsed <= 0) return '0'
  return Math.min(monthly * elapsed, depreciable).toFixed(2)
}

function filterCoa(options: CoaPick[], types: string[], subTypes?: string[]) {
  return options.filter((a) => {
    const t = String((a as CoaPick & { account_type?: string }).account_type || '').toLowerCase()
    const st = String((a as CoaPick & { account_sub_type?: string }).account_sub_type || '').toLowerCase()
    if (!types.includes(t)) return false
    if (subTypes && subTypes.length > 0) return subTypes.includes(st)
    return true
  })
}

export default function FixedAssetsPage() {
  const router = useRouter()
  const toast = useToast()
  const [assets, setAssets] = useState<FixedAsset[]>([])
  const [coaOptions, setCoaOptions] = useState<CoaPick[]>([])
  const [stations, setStations] = useState<Station[]>([])
  const [ponds, setPonds] = useState<Pond[]>([])
  const [loading, setLoading] = useState(true)
  const [currencyCode, setCurrencyCode] = useState('BDT')
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<FixedAsset | null>(null)
  const [selected, setSelected] = useState<FixedAsset | null>(null)
  const [formData, setFormData] = useState(emptyForm())
  const [batchRunning, setBatchRunning] = useState(false)
  const [schedule, setSchedule] = useState<ScheduleRow[]>([])
  const [showDisposeModal, setShowDisposeModal] = useState(false)
  const [disposeForm, setDisposeForm] = useState({ disposal_date: new Date().toISOString().split('T')[0], proceeds_amount: '0' })
  const [aquacultureEnabled, setAquacultureEnabled] = useState(false)
  const [openingAccumManual, setOpeningAccumManual] = useState(false)

  const assetCoa = useMemo(
    () =>
      filterCoa(coaOptions as (CoaPick & { account_type?: string; account_sub_type?: string })[], ['asset'], [
        'fixed_asset',
        'machinery_and_equipment',
        'vehicles',
      ]),
    [coaOptions]
  )
  const accumCoa = useMemo(
    () => filterCoa(coaOptions as (CoaPick & { account_type?: string; account_sub_type?: string })[], ['asset'], ['accumulated_depreciation']),
    [coaOptions]
  )
  const expenseCoa = useMemo(
    () => filterCoa(coaOptions as (CoaPick & { account_type?: string })[], ['expense']),
    [coaOptions]
  )
  const settlementCoa = useMemo(
    () => filterCoa(coaOptions as (CoaPick & { account_type?: string })[], ['bank_account', 'asset']),
    [coaOptions]
  )

  const formMonthlyDepreciation = useMemo(() => {
    const cost = parseFloat(formData.acquisition_cost) || 0
    const salvage = parseFloat(formData.salvage_value) || 0
    const months = parseInt(formData.useful_life_months, 10) || 0
    if (cost <= 0 || months <= 0) return null
    return Math.max(cost - salvage, 0) / months
  }, [formData.acquisition_cost, formData.salvage_value, formData.useful_life_months])

  const suggestedOpeningAccum = useMemo(
    () => computeSuggestedOpeningAccum(formData),
    [
      formData.acquisition_cost,
      formData.salvage_value,
      formData.useful_life_months,
      formData.in_service_date,
      formData.acquisition_date,
      formData.settlement_account_id,
    ]
  )

  useEffect(() => {
    if (!showModal || openingAccumManual) return
    setFormData((prev) => {
      if (prev.opening_accumulated_depreciation === suggestedOpeningAccum) return prev
      return { ...prev, opening_accumulated_depreciation: suggestedOpeningAccum }
    })
  }, [showModal, openingAccumManual, suggestedOpeningAccum])

  const fetchData = useCallback(async () => {
    try {
      const [assetsRes, coaRes, stationsRes, pondsRes, companyRes] = await Promise.allSettled([
        api.get('/fixed-assets/'),
        api.get('/chart-of-accounts/'),
        api.get('/stations/'),
        api.get('/aquaculture/ponds/'),
        api.get('/companies/current'),
      ])
      if (assetsRes.status === 'fulfilled') setAssets(assetsRes.value.data)
      if (coaRes.status === 'fulfilled') setCoaOptions(coaRes.value.data || [])
      if (stationsRes.status === 'fulfilled') {
        setStations((stationsRes.value.data || []).filter((s: Station) => s.is_active))
      }
      if (pondsRes.status === 'fulfilled') {
        setPonds((pondsRes.value.data || []).filter((p: Pond) => p.is_active))
      }
      if (companyRes.status === 'fulfilled' && companyRes.value.data?.currency) {
        setCurrencyCode(companyRes.value.data.currency)
      }
      if (companyRes.status === 'fulfilled') {
        setAquacultureEnabled(Boolean(companyRes.value.data?.aquaculture_enabled))
      }
      if (pondsRes.status === 'rejected') {
        setPonds([])
      }
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Failed to load fixed assets'))
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    fetchData()
  }, [router, fetchData])

  const openCreate = () => {
    const defaults = suggestedFixedAssetAccountIds(coaOptions)
    setEditing(null)
    setOpeningAccumManual(false)
    setFormData({ ...emptyForm(), ...defaults })
    setShowModal(true)
  }

  const openEdit = (asset: FixedAsset) => {
    setEditing(asset)
    const loaded: AssetFormData = {
      name: asset.name,
      description: asset.description || '',
      cost_center_type: asset.company_wide
        ? 'head_office'
        : asset.aquaculture_pond_id
          ? 'pond'
          : 'station',
      station_id: asset.station_id ? String(asset.station_id) : '',
      aquaculture_pond_id: asset.aquaculture_pond_id ? String(asset.aquaculture_pond_id) : '',
      asset_account_id: String(asset.asset_account_id),
      accumulated_depreciation_account_id: String(asset.accumulated_depreciation_account_id),
      depreciation_expense_account_id: String(asset.depreciation_expense_account_id),
      settlement_account_id: asset.settlement_account_id ? String(asset.settlement_account_id) : '',
      acquisition_date: asset.acquisition_date || '',
      in_service_date: asset.in_service_date || '',
      acquisition_cost: asset.acquisition_cost,
      salvage_value: asset.salvage_value,
      useful_life_months: String(asset.useful_life_months),
      opening_accumulated_depreciation: asset.opening_accumulated_depreciation,
      memo: asset.memo || '',
    }
    const suggested = computeSuggestedOpeningAccum(loaded)
    const stored = parseFloat(asset.opening_accumulated_depreciation || '0')
    setOpeningAccumManual(Math.abs(stored - parseFloat(suggested || '0')) > 0.01)
    setFormData(loaded)
    setShowModal(true)
  }

  const applySuggestedOpeningAccum = () => {
    setOpeningAccumManual(false)
    setFormData((prev) => ({
      ...prev,
      opening_accumulated_depreciation: computeSuggestedOpeningAccum(prev),
    }))
  }

  const loadDetail = async (id: number) => {
    try {
      const res = await api.get(`/fixed-assets/${id}/`)
      setSelected(res.data)
      setSchedule([])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Failed to load asset'))
    }
  }

  const loadSchedule = async (id: number) => {
    try {
      const res = await api.get(`/fixed-assets/${id}/schedule/`)
      setSchedule(res.data?.schedule || [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Failed to load schedule'))
    }
  }

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('Name is required')
      return
    }
    if (!formData.asset_account_id || !formData.accumulated_depreciation_account_id || !formData.depreciation_expense_account_id) {
      toast.error('Select asset, accumulated depreciation, and expense accounts')
      return
    }
    const companyWide = formData.cost_center_type === 'head_office'
    if (!companyWide && !formData.station_id && !formData.aquaculture_pond_id) {
      toast.error('Select where depreciation hits P&L (station, pond, or head office / shared)')
      return
    }
    if (formData.cost_center_type === 'station' && !formData.station_id) {
      toast.error('Select a station for site P&L')
      return
    }
    if (formData.cost_center_type === 'pond' && !formData.aquaculture_pond_id) {
      toast.error('Select a pond for pond P&L')
      return
    }
    const payload = {
      name: formData.name.trim(),
      description: formData.description,
      company_wide: companyWide,
      station_id: companyWide || formData.cost_center_type !== 'station' ? null : parseInt(formData.station_id, 10),
      aquaculture_pond_id:
        companyWide || formData.cost_center_type !== 'pond' ? null : parseInt(formData.aquaculture_pond_id, 10),
      asset_account_id: parseInt(formData.asset_account_id, 10),
      accumulated_depreciation_account_id: parseInt(formData.accumulated_depreciation_account_id, 10),
      depreciation_expense_account_id: parseInt(formData.depreciation_expense_account_id, 10),
      settlement_account_id: formData.settlement_account_id ? parseInt(formData.settlement_account_id, 10) : null,
      acquisition_date: formData.acquisition_date || null,
      in_service_date: formData.in_service_date || null,
      acquisition_cost: formData.acquisition_cost,
      salvage_value: formData.salvage_value || '0',
      useful_life_months: parseInt(formData.useful_life_months, 10) || 60,
      opening_accumulated_depreciation: formData.opening_accumulated_depreciation || '0',
      memo: formData.memo,
      depreciation_method: 'straight_line',
    }
    try {
      if (editing) {
        await api.put(`/fixed-assets/${editing.id}/`, payload)
        toast.success('Asset updated')
      } else {
        await api.post('/fixed-assets/', payload)
        toast.success('Asset created')
      }
      setShowModal(false)
      await fetchData()
      if (editing) await loadDetail(editing.id)
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Save failed'))
    }
  }

  const handleDelete = async (asset: FixedAsset) => {
    if (!confirm(`Delete draft asset ${asset.asset_number}?`)) return
    try {
      await api.delete(`/fixed-assets/${asset.id}/`)
      toast.success('Asset deleted')
      if (selected?.id === asset.id) setSelected(null)
      fetchData()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Delete failed'))
    }
  }

  const handlePlaceInService = async (asset: FixedAsset) => {
    try {
      await api.post(`/fixed-assets/${asset.id}/place-in-service/`, {
        in_service_date: asset.in_service_date || new Date().toISOString().split('T')[0],
        post_acquisition_gl: Boolean(asset.settlement_account_id),
      })
      toast.success('Asset placed in service')
      await fetchData()
      await loadDetail(asset.id)
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Place in service failed'))
    }
  }

  const handleDepreciate = async (asset: FixedAsset) => {
    try {
      await api.post(`/fixed-assets/${asset.id}/depreciate/`, {
        run_date: new Date().toISOString().split('T')[0],
      })
      toast.success('Depreciation posted')
      await fetchData()
      await loadDetail(asset.id)
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Depreciation failed'))
    }
  }

  const handleReverseDepreciation = async (assetId: number, runId: number) => {
    if (!confirm('Reverse this depreciation run? GL will be reversed.')) return
    try {
      await api.post(`/fixed-assets/${assetId}/depreciation-runs/${runId}/reverse/`, {})
      toast.success('Depreciation reversed')
      await fetchData()
      await loadDetail(assetId)
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Reverse failed'))
    }
  }

  const handleDispose = async () => {
    if (!selected) return
    try {
      await api.post(`/fixed-assets/${selected.id}/dispose/`, disposeForm)
      toast.success('Asset disposed')
      setShowDisposeModal(false)
      await fetchData()
      await loadDetail(selected.id)
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Disposal failed'))
    }
  }

  const handleBatchDepreciate = async () => {
    if (!confirm('Run monthly depreciation for all active assets?')) return
    setBatchRunning(true)
    try {
      const res = await api.post('/fixed-assets/depreciate-batch/', {
        run_date: new Date().toISOString().split('T')[0],
      })
      const n = res.data?.posted_count ?? 0
      toast.success(`Batch complete: ${n} asset(s) depreciated`)
      await fetchData()
      if (selected) await loadDetail(selected.id)
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Batch depreciation failed'))
    } finally {
      setBatchRunning(false)
    }
  }

  const fmt = (v: string | number) => formatCurrency(v, currencyCode)

  if (loading) {
    return (
      <div className="flex h-screen page-with-sidebar">
        <Sidebar />
        <div className="flex-1 overflow-auto app-scroll-pad flex items-center justify-center text-gray-600">
          Loading fixed assets…
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen page-with-sidebar">
      <Sidebar />
      <div className="flex-1 overflow-auto app-scroll-pad">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-2">
              <Boxes className="h-8 w-8 text-stone-600" />
              Fixed Assets & Depreciation
            </h1>
            <p className="text-gray-600 mt-1">
              Asset register with straight-line depreciation and automatic GL journals
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleBatchDepreciate}
              disabled={batchRunning}
              className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${batchRunning ? 'animate-spin' : ''}`} />
              Batch depreciate
            </button>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
            >
              <Plus className="h-4 w-4" />
              New asset
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Asset</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entity</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Cost</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Book value</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {assets.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                      No fixed assets yet. Create one to start tracking depreciation.
                    </td>
                  </tr>
                ) : (
                  assets.map((a) => (
                    <tr
                      key={a.id}
                      className={`hover:bg-gray-50 cursor-pointer ${selected?.id === a.id ? 'bg-indigo-50' : ''}`}
                      onClick={() => loadDetail(a.id)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-gray-900">{a.asset_number}</div>
                        <div className="text-sm text-gray-600">{a.name}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {a.cost_center_label || a.station_name || a.pond_name || (a.company_wide ? 'Head office / shared' : '—')}
                      </td>
                      <td className="px-4 py-3 text-sm text-right">{fmt(a.acquisition_cost)}</td>
                      <td className="px-4 py-3 text-sm text-right">{fmt(a.book_value)}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
                          {STATUS_LABELS[a.status] || a.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                        {a.status === 'draft' && (
                          <>
                            <button type="button" onClick={() => openEdit(a)} className="p-1 text-indigo-600 hover:text-indigo-800" title="Edit">
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button type="button" onClick={() => handleDelete(a)} className="p-1 text-red-600 hover:text-red-800 ml-1" title="Delete">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-lg shadow p-5">
            {!selected ? (
              <p className="text-gray-500 text-sm">Select an asset to view details and run depreciation.</p>
            ) : (
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{selected.asset_number}</h2>
                  <p className="text-gray-700">{selected.name}</p>
                  <p className="text-sm text-gray-500 mt-1">{STATUS_LABELS[selected.status] || selected.status}</p>
                </div>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <dt className="text-gray-500">Depreciation to</dt>
                  <dd className="text-right">{selected.cost_center_label || selected.station_name || selected.pond_name || '—'}</dd>
                  <dt className="text-gray-500">Acquisition cost</dt>
                  <dd className="text-right font-medium">{fmt(selected.acquisition_cost)}</dd>
                  <dt className="text-gray-500">Salvage value</dt>
                  <dd className="text-right">{fmt(selected.salvage_value)}</dd>
                  <dt className="text-gray-500">Depreciable base</dt>
                  <dd className="text-right">{fmt(selected.depreciable_base || '0')}</dd>
                  <dt className="text-gray-500">Accum. depreciation</dt>
                  <dd className="text-right">{fmt(selected.accumulated_depreciation)}</dd>
                  <dt className="text-gray-500">Book value</dt>
                  <dd className="text-right font-medium">{fmt(selected.book_value)}</dd>
                  <dt className="text-gray-500">Monthly (SL)</dt>
                  <dd className="text-right">{fmt(selected.standard_monthly_depreciation)}</dd>
                  <dt className="text-gray-500">Next run</dt>
                  <dd className="text-right">{fmt(selected.next_depreciation_amount)}</dd>
                  <dt className="text-gray-500">Useful life</dt>
                  <dd className="text-right">{selected.useful_life_months} mo</dd>
                  <dt className="text-gray-500">In service</dt>
                  <dd className="text-right">{selected.in_service_date ? formatDateOnly(selected.in_service_date) : '—'}</dd>
                </dl>
                <div className="flex flex-wrap gap-2 pt-2">
                  {selected.status === 'draft' && (
                    <button
                      type="button"
                      onClick={() => handlePlaceInService(selected)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
                    >
                      <PlayCircle className="h-4 w-4" />
                      Place in service
                    </button>
                  )}
                  {selected.status === 'active' && (
                    <button
                      type="button"
                      onClick={() => handleDepreciate(selected)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700"
                    >
                      <TrendingDown className="h-4 w-4" />
                      Run depreciation
                    </button>
                  )}
                  {(selected.status === 'active' || selected.status === 'fully_depreciated') && (
                    <button
                      type="button"
                      onClick={() => {
                        setDisposeForm({
                          disposal_date: new Date().toISOString().split('T')[0],
                          proceeds_amount: '0',
                        })
                        setShowDisposeModal(true)
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
                    >
                      <Trash className="h-4 w-4" />
                      Dispose
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => loadSchedule(selected.id)}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                  >
                    <Calendar className="h-4 w-4" />
                    Schedule
                  </button>
                  {selected.status === 'draft' && (
                    <button
                      type="button"
                      onClick={() => openEdit(selected)}
                      className="inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
                    >
                      <Edit2 className="h-4 w-4" />
                      Edit
                    </button>
                  )}
                </div>
                {(selected.acquisition_journal_entry_id || selected.disposal_journal_entry_id) && (
                  <div className="text-sm space-y-1">
                    {selected.acquisition_journal_entry_id ? (
                      <Link
                        href={`/journal-entries?highlight=${selected.acquisition_journal_entry_id}`}
                        className="text-indigo-600 hover:underline inline-flex items-center gap-1"
                      >
                        Acquisition JE #{selected.acquisition_journal_entry_id}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : null}
                    {selected.disposal_journal_entry_id ? (
                      <Link
                        href={`/journal-entries?highlight=${selected.disposal_journal_entry_id}`}
                        className="text-indigo-600 hover:underline inline-flex items-center gap-1 block"
                      >
                        Disposal JE #{selected.disposal_journal_entry_id}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    ) : null}
                  </div>
                )}
                {schedule.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 mb-2">Projected schedule</h3>
                    <ul className="text-sm space-y-1 max-h-40 overflow-y-auto">
                      {schedule.slice(0, 12).map((row) => (
                        <li key={row.period_index} className="flex justify-between text-gray-700 border-b border-gray-100 py-1">
                          <span>{formatDateOnly(row.run_date)}</span>
                          <span>{fmt(row.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {selected.depreciation_runs && selected.depreciation_runs.length > 0 && (
                  <div>
                    <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-1 mb-2">
                      <Calendar className="h-4 w-4" />
                      Depreciation history
                    </h3>
                    <ul className="text-sm space-y-2 max-h-48 overflow-y-auto">
                      {selected.depreciation_runs.map((r) => (
                        <li key={r.id} className="border-b border-gray-100 pb-2">
                          <div className="flex justify-between text-gray-700">
                            <span>{formatDateOnly(r.run_date)}</span>
                            <span>{fmt(r.amount)}</span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            {r.journal_entry_id ? (
                              <Link
                                href={`/journal-entries?highlight=${r.journal_entry_id}`}
                                className="text-xs text-indigo-600 hover:underline"
                              >
                                JE #{r.journal_entry_id}
                              </Link>
                            ) : null}
                            {r.reversed_at ? (
                              <span className="text-xs text-gray-500">Reversed</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleReverseDepreciation(selected.id, r.id)}
                                className="text-xs text-amber-700 hover:underline inline-flex items-center gap-0.5"
                              >
                                <RotateCcw className="h-3 w-3" />
                                Reverse
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {showModal && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="flex items-center justify-between px-6 py-4 border-b">
                <h2 className="text-xl font-semibold">{editing ? 'Edit asset' : 'New fixed asset'}</h2>
                <button type="button" onClick={() => setShowModal(false)} className="text-gray-500 hover:text-gray-700">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="px-6 py-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Charge depreciation to (P&L) *</label>
                    <select
                      value={formData.cost_center_type}
                      onChange={(e) => {
                        const v = e.target.value as CostCenterType
                        setFormData({
                          ...formData,
                          cost_center_type: v,
                          station_id: v === 'station' ? formData.station_id : '',
                          aquaculture_pond_id: v === 'pond' ? formData.aquaculture_pond_id : '',
                        })
                      }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    >
                      <option value="station">One station (Adib, Premium Agro, …)</option>
                      <option value="pond">One pond (Nursing, Grow-out, …)</option>
                      <option value="head_office">Head office / shared (all sites — e.g. manager motorcycle)</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      FSERP tags each depreciation line to one place. Shared assets use head office so Adib/Premium Agro/pond P&L are not distorted.
                    </p>
                  </div>
                  {formData.cost_center_type === 'station' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Station</label>
                    <select
                      value={formData.station_id}
                      onChange={(e) => setFormData({ ...formData, station_id: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    >
                      <option value="">— None —</option>
                      {stations.map((s) => (
                        <option key={s.id} value={s.id}>{s.station_name}</option>
                      ))}
                    </select>
                  </div>
                  )}
                  {formData.cost_center_type === 'pond' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Pond</label>
                    <select
                      value={formData.aquaculture_pond_id}
                      onChange={(e) => setFormData({ ...formData, aquaculture_pond_id: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      disabled={!aquacultureEnabled}
                    >
                      <option value="">— None —</option>
                      {ponds.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    {!aquacultureEnabled && (
                      <p className="text-xs text-gray-500 mt-1">Aquaculture module off — use Station or Head office.</p>
                    )}
                  </div>
                  )}
                  <div className="md:col-span-2 border-t border-gray-200 pt-4 mt-1">
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">Acquisition</h3>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Acquisition cost *</label>
                    <input
                      type="number"
                      step="0.01"
                      value={formData.acquisition_cost}
                      onChange={(e) => setFormData({ ...formData, acquisition_cost: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div className="md:col-span-2 border-t border-gray-200 pt-4 mt-1">
                    <h3 className="text-sm font-semibold text-gray-900 mb-1">Depreciation (straight-line)</h3>
                    <p className="text-xs text-gray-500 mb-3">
                      Monthly amount = (Cost − Salvage) ÷ Useful life months. Depreciation stops at salvage value.
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">In-service date</label>
                    <input
                      type="date"
                      value={formData.in_service_date}
                      onChange={(e) => setFormData({ ...formData, in_service_date: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                    <p className="text-xs text-gray-500 mt-1">When the asset started depreciating (for opening balance estimate).</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Acquisition date</label>
                    <input
                      type="date"
                      value={formData.acquisition_date}
                      onChange={(e) => setFormData({ ...formData, acquisition_date: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Salvage value (end-of-life scrap/residual) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.salvage_value}
                      onChange={(e) => setFormData({ ...formData, salvage_value: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                    <p className="text-xs text-gray-500 mt-1">Expected value when fully depreciated (e.g. motorcycle scrap/sale at end of life).</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Useful life (months) *</label>
                    <input
                      type="number"
                      value={formData.useful_life_months}
                      onChange={(e) => setFormData({ ...formData, useful_life_months: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Opening accum. depr.</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.opening_accumulated_depreciation}
                      onChange={(e) => {
                        setOpeningAccumManual(true)
                        setFormData({ ...formData, opening_accumulated_depreciation: e.target.value })
                      }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                      disabled={Boolean(editing && editing.status !== 'draft')}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      {formData.settlement_account_id
                        ? 'Auto: 0 for new purchases (capitalized via settlement). Clear settlement for mid-life adoption.'
                        : `Auto-suggested: ${fmt(suggestedOpeningAccum)} from in-service date to today.`}
                      {openingAccumManual &&
                      formData.opening_accumulated_depreciation !== suggestedOpeningAccum &&
                      !(editing && editing.status !== 'draft') ? (
                        <>
                          {' '}
                          <button
                            type="button"
                            onClick={applySuggestedOpeningAccum}
                            className="text-indigo-600 hover:underline"
                          >
                            Use suggested ({fmt(suggestedOpeningAccum)})
                          </button>
                        </>
                      ) : null}
                    </p>
                  </div>
                  {formMonthlyDepreciation != null && (
                    <div className="md:col-span-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900">
                      Estimated monthly depreciation: <strong>{fmt(formMonthlyDepreciation)}</strong>
                      {' '}(after salvage)
                    </div>
                  )}
                  <div className="md:col-span-2 border-t border-gray-200 pt-4 mt-1">
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">GL accounts</h3>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Asset account *</label>
                    <select
                      value={formData.asset_account_id}
                      onChange={(e) => setFormData({ ...formData, asset_account_id: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    >
                      <option value="">{templateCoaOptionLabel(COA_FIXED_EQUIPMENT, coaOptions)}</option>
                      {assetCoa.map((a) => (
                        <option key={a.id} value={a.id}>{formatCoaOptionLabel(a)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Accum. depreciation *</label>
                    <select
                      value={formData.accumulated_depreciation_account_id}
                      onChange={(e) => setFormData({ ...formData, accumulated_depreciation_account_id: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    >
                      <option value="">{templateCoaOptionLabel(COA_ACCUM_DEPR, coaOptions)}</option>
                      {accumCoa.map((a) => (
                        <option key={a.id} value={a.id}>{formatCoaOptionLabel(a)}</option>
                      ))}
                      {accumCoa.length === 0 && (
                        <option value="" disabled>{COA_ACCUM_DEPR} — add in Chart of Accounts</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Depreciation expense *</label>
                    <select
                      value={formData.depreciation_expense_account_id}
                      onChange={(e) => setFormData({ ...formData, depreciation_expense_account_id: e.target.value })}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    >
                      <option value="">{templateCoaOptionLabel(COA_DEPR_EXPENSE, coaOptions)}</option>
                      {expenseCoa.map((a) => (
                        <option key={a.id} value={a.id}>{formatCoaOptionLabel(a)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Settlement (optional)</label>
                    <select
                      value={formData.settlement_account_id}
                      onChange={(e) => {
                        const val = e.target.value
                        setOpeningAccumManual(false)
                        setFormData({
                          ...formData,
                          settlement_account_id: val,
                          opening_accumulated_depreciation: val ? '0' : computeSuggestedOpeningAccum({
                            ...formData,
                            settlement_account_id: val,
                          }),
                        })
                      }}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    >
                      <option value="">— No acquisition JE —</option>
                      {settlementCoa.map((a) => (
                        <option key={a.id} value={a.id}>{formatCoaOptionLabel(a)}</option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      Bank/cash credited on place-in-service (Dr asset / Cr bank). Pay vendor via Bills first, or pick the bank account used.
                    </p>
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Memo</label>
                    <textarea
                      value={formData.memo}
                      onChange={(e) => setFormData({ ...formData, memo: e.target.value })}
                      rows={2}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2"
                    />
                  </div>
                </div>
              </div>
              <div className="px-6 py-4 border-t flex justify-end gap-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
                  Cancel
                </button>
                <button type="button" onClick={handleSave} className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {showDisposeModal && selected && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
              <h2 className="text-lg font-semibold mb-4">Dispose {selected.asset_number}</h2>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Disposal date</label>
                  <input
                    type="date"
                    value={disposeForm.disposal_date}
                    onChange={(e) => setDisposeForm({ ...disposeForm, disposal_date: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Proceeds amount</label>
                  <input
                    type="number"
                    step="0.01"
                    value={disposeForm.proceeds_amount}
                    onChange={(e) => setDisposeForm({ ...disposeForm, proceeds_amount: e.target.value })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Book value: {fmt(selected.book_value)} · Salvage: {fmt(selected.salvage_value)}.
                    Gain/loss on disposal = proceeds − book value (posted automatically).
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-6">
                <button type="button" onClick={() => setShowDisposeModal(false)} className="px-4 py-2 border rounded-lg">
                  Cancel
                </button>
                <button type="button" onClick={handleDispose} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700">
                  Post disposal
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
