'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  List,
  Gauge,
  MapPin,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  UtensilsCrossed,
  XCircle,
} from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatDateOnly } from '@/utils/date'
import { getCurrencySymbol } from '@/utils/currency'
import {
  AdvicePlanCard,
  AdviceRichText,
  FeedingDoseEditor,
  FeedingInsightHero,
  MealPlanTable,
  PageTipsAside,
  PipelineStatCard,
  StatusFilterTabs,
  WorkflowRail,
} from './FeedingUi'
import {
  type AdviceStatusFilter,
  type FeedingAdviceRow,
  SACK_SIZE_OPTIONS_KG,
  buildMealPlanRows,
  mealPlanForFieldApply,
  feedInventoryQtyFromKgForEstimate,
  feedKgToSackLabel,
  isoToday,
  isAllowedSackKg,
  kgStrFromSacks,
  rowSackKg,
  sacksStrFromKg,
  snapshotFeedingSchedule,
  snapshotWorldfish,
  statusPill,
} from './feedingUtils'

interface Pond {
  id: number
  name: string
}

interface CycleRow {
  id: number
  name: string
}

interface PondWarehouseItemRow {
  item_id: number
  item_name: string
  unit: string
  quantity: string
  pos_category: string
  reporting_category: string
  content_weight_kg: string | null
  unit_cost: string
}

export default function AquacultureFeedingPage() {
  const toast = useToast()
  const searchRef = useRef<HTMLInputElement>(null)
  const [ponds, setPonds] = useState<Pond[]>([])
  const [cycles, setCycles] = useState<CycleRow[]>([])
  const [rows, setRows] = useState<FeedingAdviceRow[]>([])
  const [filterPond, setFilterPond] = useState('')
  const [filterStatus, setFilterStatus] = useState<AdviceStatusFilter>('all')
  const [todayOnly, setTodayOnly] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [currency, setCurrency] = useState('BDT')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<FeedingAdviceRow | null>(null)
  const [showAdvancedGen, setShowAdvancedGen] = useState(false)

  const [genPond, setGenPond] = useState('')
  const [genCycle, setGenCycle] = useState('')
  const [genDate, setGenDate] = useState(isoToday)
  const [genTemp, setGenTemp] = useState('')
  const [genSackKg, setGenSackKg] = useState<(typeof SACK_SIZE_OPTIONS_KG)[number]>(25)
  const [genBusy, setGenBusy] = useState(false)

  const [editText, setEditText] = useState('')
  const [editKg, setEditKg] = useState('')
  const [editSackSize, setEditSackSize] = useState<string>('25')
  const [editSacks, setEditSacks] = useState('')
  const [saveBusy, setSaveBusy] = useState(false)
  const [sackSaveBusy, setSackSaveBusy] = useState(false)

  const [applyKg, setApplyKg] = useState('')
  const [applySacks, setApplySacks] = useState('')
  const [applyCreateExp, setApplyCreateExp] = useState(false)
  const [applyConsumePond, setApplyConsumePond] = useState(true)
  const [applyFeedItemId, setApplyFeedItemId] = useState('')
  const [applyManualPurchaseAmount, setApplyManualPurchaseAmount] = useState(false)
  const [pondWhStock, setPondWhStock] = useState<PondWarehouseItemRow[]>([])
  const [whStockLoading, setWhStockLoading] = useState(false)
  const [applyAmount, setApplyAmount] = useState('')
  const [applyVendor, setApplyVendor] = useState('')
  const [applyMemo, setApplyMemo] = useState('')
  const [applyBusy, setApplyBusy] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteLinkedExpenseBusy, setDeleteLinkedExpenseBusy] = useState(false)

  const loadPonds = useCallback(async () => {
    try {
      const { data } = await api.get<Pond[]>('/aquaculture/ponds/')
      setPonds(Array.isArray(data) ? data : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load ponds'))
    }
  }, [toast])

  const loadList = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {}
      if (filterPond) params.pond_id = filterPond
      if (filterStatus !== 'all') params.status = filterStatus
      const { data } = await api.get<FeedingAdviceRow[]>('/aquaculture/feeding-advice/', {
        params: Object.keys(params).length ? params : undefined,
      })
      const list = Array.isArray(data) ? data : []
      setRows(list)
      setSelected((prev) => {
        if (!prev) return null
        return list.find((x) => x.id === prev.id) ?? null
      })
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load feeding advice'))
    } finally {
      setLoading(false)
    }
  }, [toast, filterPond, filterStatus])

  const loadCurrency = useCallback(async () => {
    try {
      const { data } = await api.get<Record<string, unknown>>('/companies/current/')
      setCurrency(String(data?.currency || 'BDT').slice(0, 3))
    } catch {
      setCurrency('BDT')
    }
  }, [])

  useEffect(() => {
    void loadPonds()
    void loadCurrency()
  }, [loadPonds, loadCurrency])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    const pid = genPond
    if (!pid) {
      setCycles([])
      setGenCycle('')
      return
    }
    void (async () => {
      try {
        const { data } = await api.get<CycleRow[]>('/aquaculture/production-cycles/', { params: { pond_id: pid } })
        setCycles(Array.isArray(data) ? data : [])
      } catch {
        setCycles([])
      }
    })()
  }, [genPond])

  useEffect(() => {
    if (!selected) {
      setEditText('')
      setEditKg('')
      setEditSackSize('25')
      setEditSacks('')
      setApplyKg('')
      setApplySacks('')
      return
    }
    setEditText(selected.edited_advice_text || '')
    setEditKg(selected.suggested_feed_kg ?? '')
    const sk = rowSackKg(selected)
    setEditSackSize(String(sk))
    setEditSacks(sacksStrFromKg(selected.suggested_feed_kg ?? '', sk))
    setApplyKg(selected.suggested_feed_kg ?? '')
    setApplySacks(sacksStrFromKg(selected.suggested_feed_kg ?? '', sk))
    setApplyFeedItemId('')
    setApplyManualPurchaseAmount(false)
  }, [selected])

  useEffect(() => {
    if (applyCreateExp) {
      setApplyConsumePond(false)
      return
    }
    if (!selected || selected.status !== 'approved') return
    if (selected.pond_default_feed_item_id) {
      setApplyConsumePond(true)
      return
    }
    if (whStockLoading) {
      setApplyConsumePond(false)
      return
    }
    setApplyConsumePond(pondWhStock.length > 0)
  }, [
    applyCreateExp,
    selected?.id,
    selected?.status,
    selected?.pond_default_feed_item_id,
    pondWhStock.length,
    whStockLoading,
  ])

  useEffect(() => {
    if (!selected || selected.status !== 'approved') {
      setPondWhStock([])
      setWhStockLoading(false)
      return
    }
    const pid = selected.pond_id
    let cancelled = false
    setWhStockLoading(true)
    void (async () => {
      try {
        const { data } = await api.get<{ items?: PondWarehouseItemRow[] }>(
          `/aquaculture/ponds/${pid}/warehouse-stock/`,
        )
        if (!cancelled) setPondWhStock(Array.isArray(data?.items) ? data.items : [])
      } catch {
        if (!cancelled) setPondWhStock([])
      } finally {
        if (!cancelled) setWhStockLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selected?.id, selected?.status, selected?.pond_id])

  const todayIso = isoToday()

  const displayRows = useMemo(() => {
    let list = rows
    if (todayOnly) list = list.filter((r) => r.target_date === todayIso)
    const q = searchQuery.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (r) =>
        r.pond_name.toLowerCase().includes(q) ||
        (r.production_cycle_name || '').toLowerCase().includes(q) ||
        r.status_label.toLowerCase().includes(q) ||
        String(r.id).includes(q),
    )
  }, [rows, searchQuery, todayOnly, todayIso])

  const pipelineStats = useMemo(() => {
    const pending = rows.filter((r) => r.status === 'pending_review').length
    const approved = rows.filter((r) => r.status === 'approved').length
    const applied = rows.filter((r) => r.status === 'applied').length
    const cancelled = rows.filter((r) => r.status === 'cancelled').length
    return { pending, approved, applied, cancelled, total: rows.length }
  }, [rows])

  const statusTabCounts = useMemo(
    (): Record<AdviceStatusFilter, number> => ({
      all: rows.length,
      pending_review: pipelineStats.pending,
      approved: pipelineStats.approved,
      applied: pipelineStats.applied,
      cancelled: pipelineStats.cancelled,
    }),
    [rows.length, pipelineStats],
  )

  const selectedHiddenBySearch = Boolean(
    selected && !displayRows.some((r) => r.id === selected.id),
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selected) setSelected(null)
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  const sym = getCurrencySymbol(currency)

  const worldfishBlock = useMemo(() => {
    const snap = selected?.pond_status_snapshot as Record<string, unknown> | undefined
    return snapshotWorldfish(snap)
  }, [selected])

  const feedingScheduleBlock = useMemo(() => {
    const snap = selected?.pond_status_snapshot as Record<string, unknown> | undefined
    return snapshotFeedingSchedule(snap)
  }, [selected])

  const feedingScheduleBullets = useMemo((): string[] => {
    const raw = feedingScheduleBlock?.rationale_bullets
    if (!Array.isArray(raw)) return []
    return raw.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
  }, [feedingScheduleBlock])

  const recommendedFeedingTimes = useMemo((): string[] => {
    const raw = feedingScheduleBlock?.recommended_feeding_times
    if (!Array.isArray(raw)) return []
    return raw.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
  }, [feedingScheduleBlock])

  const mealPlan = useMemo(
    () => buildMealPlanRows(selected, feedingScheduleBlock, recommendedFeedingTimes),
    [selected, feedingScheduleBlock, recommendedFeedingTimes],
  )

  const activeDoseKg = useMemo(() => {
    if (!selected) return ''
    if (selected.status === 'pending_review') return editKg.trim()
    if (selected.status === 'approved') return applyKg.trim()
    return ''
  }, [selected, editKg, applyKg])

  const { plan: displayMealPlan, scaled: mealPlanScaled } = useMemo(() => {
    if (!selected || (selected.status !== 'pending_review' && selected.status !== 'approved')) {
      return { plan: mealPlan, scaled: false }
    }
    return mealPlanForFieldApply(mealPlan, activeDoseKg, selected.suggested_feed_kg)
  }, [mealPlan, activeDoseKg, selected?.status, selected?.suggested_feed_kg])

  const sackKgForDisplay = useMemo((): number => {
    const n = Number.parseInt(editSackSize, 10)
    if (isAllowedSackKg(n)) return n
    return rowSackKg(selected)
  }, [editSackSize, selected])

  /** Daily plans list reflects in-progress kg/sack edits for the selected row. */
  const listDisplayRows = useMemo(() => {
    if (!selected?.id) return displayRows
    if (selected.status !== 'pending_review' && selected.status !== 'approved') return displayRows
    return displayRows.map((r) => {
      if (r.id !== selected.id) return r
      return {
        ...r,
        suggested_feed_kg: activeDoseKg !== '' ? activeDoseKg : r.suggested_feed_kg,
        sack_size_kg: sackKgForDisplay,
      }
    })
  }, [displayRows, selected?.id, selected?.status, activeDoseKg, sackKgForDisplay])

  const mealsLabel = useMemo(() => {
    const raw =
      feedingScheduleBlock?.times_per_day ?? worldfishBlock?.meals_hint
    return raw != null ? String(raw) : null
  }, [feedingScheduleBlock, worldfishBlock])

  const weatherLabel = useMemo(() => {
    const raw = feedingScheduleBlock?.weather_condition_label
    return raw != null && String(raw).trim() !== '' ? String(raw) : null
  }, [feedingScheduleBlock])

  const purchaseAmountEstimateLabel = useMemo(() => {
    if (!applyCreateExp || applyManualPurchaseAmount) return null
    const kgStr = applyKg.trim() || selected?.suggested_feed_kg?.trim() || ''
    const kg = Number.parseFloat(kgStr)
    if (!Number.isFinite(kg) || kg <= 0) return 'Set feed weight (kg) to see an estimate.'
    const pickId =
      applyFeedItemId.trim() !== ''
        ? Number.parseInt(applyFeedItemId, 10)
        : selected?.pond_default_feed_item_id ?? null
    if (pickId == null || !Number.isFinite(pickId)) {
      return 'Pick a feed product or set the pond default feed for costing.'
    }
    const row = pondWhStock.find((r) => r.item_id === pickId)
    if (!row) {
      return 'Amount is computed on apply from the item’s inventory cost × quantity for this kg.'
    }
    const uc = Number.parseFloat(row.unit_cost)
    const qty = feedInventoryQtyFromKgForEstimate(kg, row.unit, row.content_weight_kg, sackKgForDisplay)
    if (qty != null && Number.isFinite(uc) && uc > 0) {
      return `${sym}${(qty * uc).toFixed(2)} (inventory unit cost × qty)`
    }
    return 'Check the item’s unit, content weight, and cost.'
  }, [
    applyCreateExp,
    applyFeedItemId,
    applyKg,
    applyManualPurchaseAmount,
    pondWhStock,
    sackKgForDisplay,
    selected?.pond_default_feed_item_id,
    selected?.suggested_feed_kg,
    sym,
  ])

  const applyPlanBlockedByWarehouseLoad = Boolean(
    selected?.status === 'approved' &&
      !applyCreateExp &&
      applyConsumePond &&
      !selected?.pond_default_feed_item_id &&
      whStockLoading,
  )

  const onSackSizeSelectChange = (v: string) => {
    setEditSackSize(v)
    const sk = Number.parseInt(v, 10)
    if (!isAllowedSackKg(sk)) return
    setEditSacks(sacksStrFromKg(editKg, sk))
    if (selected?.status === 'approved') setApplySacks(sacksStrFromKg(applyKg, sk))
  }

  const onEditKgChange = (v: string) => {
    setEditKg(v)
    setEditSacks(sacksStrFromKg(v, sackKgForDisplay))
  }

  const onEditSacksChange = (v: string) => {
    const t = v.trim()
    if (t === '') {
      setEditSacks('')
      setEditKg('')
      return
    }
    const n = Number.parseFloat(t)
    if (!Number.isFinite(n) || n < 0) {
      setEditSacks(v)
      return
    }
    const sacks = Math.round(n)
    setEditSacks(String(sacks))
    setEditKg(kgStrFromSacks(String(sacks), sackKgForDisplay))
  }

  const onApplyKgChange = (v: string) => {
    setApplyKg(v)
    setApplySacks(sacksStrFromKg(v, sackKgForDisplay))
  }

  const onApplySacksChange = (v: string) => {
    const t = v.trim()
    if (t === '') {
      setApplySacks('')
      setApplyKg('')
      return
    }
    const n = Number.parseFloat(t)
    if (!Number.isFinite(n) || n < 0) {
      setApplySacks(v)
      return
    }
    const sacks = Math.round(n)
    setApplySacks(String(sacks))
    setApplyKg(kgStrFromSacks(String(sacks), sackKgForDisplay))
  }

  const resetToSuggestedDose = useCallback(() => {
    const kg = selected?.suggested_feed_kg ?? ''
    if (selected?.status === 'pending_review') {
      onEditKgChange(kg)
    } else if (selected?.status === 'approved') {
      onApplyKgChange(kg)
    }
  }, [selected?.status, selected?.suggested_feed_kg, sackKgForDisplay])

  const sackSelect = (
    <label className="block text-xs font-medium text-slate-700">
      Sack size (kg)
      <select
        className="mt-1 w-full max-w-xs rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
        value={editSackSize}
        onChange={(e) => onSackSizeSelectChange(e.target.value)}
      >
        {SACK_SIZE_OPTIONS_KG.map((kg) => (
          <option key={kg} value={String(kg)}>
            {kg} kg / sack
          </option>
        ))}
      </select>
    </label>
  )

  const generate = async () => {
    if (!genPond) {
      toast.error('Select a pond')
      return
    }
    setGenBusy(true)
    try {
      const body: Record<string, unknown> = {
        pond_id: parseInt(genPond, 10),
        target_date: genDate,
        sack_size_kg: genSackKg,
      }
      if (genCycle) body.production_cycle_id = parseInt(genCycle, 10)
      if (genTemp.trim() !== '') {
        const t = Number(genTemp)
        if (!Number.isFinite(t)) {
          toast.error('Water temperature must be a number (°C)')
          setGenBusy(false)
          return
        }
        body.water_temp_c = t
      }
      const { data } = await api.post<FeedingAdviceRow>('/aquaculture/feeding-advice/generate/', body)
      toast.success('Daily plan ready — review and approve')
      await loadList()
      setSelected(data)
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Generate failed'))
    } finally {
      setGenBusy(false)
    }
  }

  const saveEdits = async () => {
    if (!selected || selected.status !== 'pending_review') return
    setSaveBusy(true)
    try {
      const { data } = await api.put<FeedingAdviceRow>(`/aquaculture/feeding-advice/${selected.id}/`, {
        edited_advice_text: editText,
        suggested_feed_kg: editKg.trim() === '' ? null : editKg.trim(),
        sack_size_kg: Number.parseInt(editSackSize, 10),
      })
      toast.success('Saved')
      setSelected(data)
      void loadList()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Save failed'))
    } finally {
      setSaveBusy(false)
    }
  }

  const saveSackSizeOnly = async () => {
    if (!selected || (selected.status !== 'approved' && selected.status !== 'applied')) return
    setSackSaveBusy(true)
    try {
      const { data } = await api.put<FeedingAdviceRow>(`/aquaculture/feeding-advice/${selected.id}/`, {
        sack_size_kg: Number.parseInt(editSackSize, 10),
      })
      toast.success('Sack size saved')
      setSelected(data)
      void loadList()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not save sack size'))
    } finally {
      setSackSaveBusy(false)
    }
  }

  const approve = async () => {
    if (!selected || selected.status !== 'pending_review') return
    try {
      const kgPayload = editKg.trim() === '' ? null : editKg.trim()
      const needsSave =
        (selected.edited_advice_text || '') !== editText ||
        String(selected.suggested_feed_kg ?? '') !== String(kgPayload ?? '') ||
        String(rowSackKg(selected)) !== editSackSize
      let row = selected
      if (needsSave) {
        const { data: saved } = await api.put<FeedingAdviceRow>(`/aquaculture/feeding-advice/${selected.id}/`, {
          edited_advice_text: editText,
          suggested_feed_kg: kgPayload,
          sack_size_kg: Number.parseInt(editSackSize, 10),
        })
        row = saved
      }
      const { data } = await api.post<FeedingAdviceRow>(`/aquaculture/feeding-advice/${row.id}/approve/`, {})
      toast.success('Approved — ready to apply in the field')
      setSelected(data)
      setApplyKg(data.suggested_feed_kg ?? '')
      setApplySacks(sacksStrFromKg(data.suggested_feed_kg ?? '', rowSackKg(data)))
      void loadList()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Approve failed'))
    }
  }

  const disapproveAdvice = async () => {
    if (!selected || selected.status !== 'approved') return
    if (!window.confirm('Send this plan back to review? Approval will be cleared.')) return
    try {
      const { data } = await api.post<FeedingAdviceRow>(
        `/aquaculture/feeding-advice/${selected.id}/disapprove/`,
        {},
      )
      toast.success('Sent back to review')
      setSelected(data)
      void loadList()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not revoke approval'))
    }
  }

  const cancelAdvice = async () => {
    if (!selected || (selected.status !== 'pending_review' && selected.status !== 'approved')) return
    const msg =
      selected.status === 'approved'
        ? 'Cancel this approved plan? It cannot be applied afterward.'
        : 'Cancel this draft?'
    if (!window.confirm(msg)) return
    try {
      const { data } = await api.post<FeedingAdviceRow>(`/aquaculture/feeding-advice/${selected.id}/cancel/`, {})
      toast.success('Cancelled')
      setSelected(data)
      void loadList()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Cancel failed'))
    }
  }

  const deleteCancelled = async () => {
    if (!selected || selected.status !== 'cancelled') return
    if (!window.confirm('Permanently delete this record?')) return
    setDeleteBusy(true)
    try {
      await api.delete(`/aquaculture/feeding-advice/${selected.id}/`)
      toast.success('Deleted')
      setSelected(null)
      void loadList()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Delete failed'))
    } finally {
      setDeleteBusy(false)
    }
  }

  const deleteLinkedExpense = async () => {
    if (!selected?.linked_expense_id) return
    const cat = selected.linked_expense_category || ''
    const isConsume = cat === 'feed_consumed'
    const msg = isConsume
      ? 'Delete the linked feed consumption expense? Pond warehouse stock will be restored and the COGS journal will be reversed. The feeding advice will stay marked as applied (for audit).'
      : cat === 'feed_purchase'
        ? 'Delete the linked feed purchase expense? Pond warehouse quantity will not change (it was never reduced). The feeding advice will stay marked as applied.'
        : 'Delete the linked expense? The feeding advice will stay marked as applied.'
    if (!window.confirm(msg)) return
    setDeleteLinkedExpenseBusy(true)
    try {
      await api.delete(`/aquaculture/expenses/${selected.linked_expense_id}/`)
      toast.success(isConsume ? 'Expense deleted — pond stock restored' : 'Expense deleted')
      const pondIdToRefresh = selected.pond_id
      const adviceId = selected.id
      void loadList()
      try {
        const { data: fresh } = await api.get<FeedingAdviceRow>(`/aquaculture/feeding-advice/${adviceId}/`)
        setSelected(fresh)
      } catch {
        setSelected((prev) =>
          prev
            ? {
                ...prev,
                linked_expense_id: null,
                linked_expense_category: '',
              }
            : null,
        )
      }
      try {
        const { data: wh } = await api.get<{ items?: PondWarehouseItemRow[] }>(
          `/aquaculture/ponds/${pondIdToRefresh}/warehouse-stock/`,
        )
        setPondWhStock(Array.isArray(wh?.items) ? wh.items : [])
      } catch {
        /* ignore */
      }
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not delete expense'))
    } finally {
      setDeleteLinkedExpenseBusy(false)
    }
  }

  const apply = async () => {
    if (!selected || selected.status !== 'approved') return
    if (!applyCreateExp && applyConsumePond) {
      if (!selected.pond_default_feed_item_id && !applyFeedItemId.trim()) {
        toast.error('Select feed from pond warehouse or set pond default feed.')
        return
      }
    }
    if (applyCreateExp && !applyManualPurchaseAmount) {
      if (!selected.pond_default_feed_item_id && !applyFeedItemId.trim()) {
        toast.error('Choose a feed product or enable override amount.')
        return
      }
    }
    setApplyBusy(true)
    try {
      const body: Record<string, unknown> = {}
      if (applyKg.trim() !== '') body.feed_weight_kg = applyKg.trim()
      if (applyCreateExp) {
        body.create_expense = true
        if (applyManualPurchaseAmount) {
          const amt = Number(applyAmount)
          if (!Number.isFinite(amt) || amt <= 0) {
            toast.error('Enter a valid expense amount')
            setApplyBusy(false)
            return
          }
          body.amount = amt
        }
        if (applyFeedItemId.trim() !== '') body.feed_item_id = Number.parseInt(applyFeedItemId, 10)
        body.vendor_name = applyVendor.trim() || 'Feed supplier'
        body.memo = applyMemo.trim() || `Feed applied (advice #${selected.id})`
        body.expense_date = selected.target_date
        body.expense_category = 'feed_purchase'
      } else {
        body.consume_pond_stock = applyConsumePond
        if (applyConsumePond && applyFeedItemId.trim() !== '') {
          body.feed_item_id = Number.parseInt(applyFeedItemId, 10)
        }
      }
      const pondIdToRefresh = selected.pond_id
      const feedItemIdForStock =
        applyFeedItemId.trim() !== ''
          ? Number.parseInt(applyFeedItemId, 10)
          : selected.pond_default_feed_item_id ?? null
      const { data } = await api.post<
        FeedingAdviceRow & { created_expense?: { expense_category?: string; feed_sack_count?: string | null } }
      >(`/aquaculture/feeding-advice/${selected.id}/apply/`, body)
      setSelected(data)
      void loadList()

      let whItems: PondWarehouseItemRow[] = []
      try {
        const { data: wh } = await api.get<{ items?: PondWarehouseItemRow[] }>(
          `/aquaculture/ponds/${pondIdToRefresh}/warehouse-stock/`,
        )
        whItems = Array.isArray(wh?.items) ? wh.items : []
        setPondWhStock(whItems)
      } catch {
        /* ignore */
      }

      const expCat =
        data.created_expense?.expense_category?.trim() ||
        data.linked_expense_category?.trim() ||
        (applyCreateExp ? 'feed_purchase' : applyConsumePond ? 'feed_consumed' : '')

      if (expCat === 'feed_purchase') {
        toast.error(
          'Applied, but pond warehouse was not reduced — you used “Record feed purchase expense”. To deduct sacks from pond on-hand, apply again with only “Consume pond warehouse” checked (or delete the purchase expense first).',
          9000,
        )
      } else if (expCat === 'feed_consumed') {
        const stockRow =
          feedItemIdForStock != null && Number.isFinite(feedItemIdForStock)
            ? whItems.find((r) => r.item_id === feedItemIdForStock)
            : undefined
        const sacksLabel = applySacks.trim() || data.created_expense?.feed_sack_count || ''
        if (stockRow) {
          toast.success(
            `Applied — ${sacksLabel ? `${sacksLabel} sack(s) consumed. ` : ''}Pond warehouse now shows ${stockRow.quantity} ${stockRow.unit} on hand.`,
          )
        } else {
          toast.success('Applied — feed deducted from pond warehouse (COGS posted).')
        }
      } else if (!applyCreateExp && !applyConsumePond) {
        toast.success('Applied — field record only (no pond stock or expense was changed).')
      } else {
        toast.success('Applied to pond')
      }
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Apply failed'))
    } finally {
      setApplyBusy(false)
    }
  }

  const pendingPonds = useMemo(() => {
    const ids = new Set(
      rows.filter((r) => r.status === 'pending_review' && r.target_date === todayIso).map((r) => r.pond_id),
    )
    return ponds.filter((p) => ids.has(p.id)).slice(0, 4)
  }, [rows, ponds, todayIso])

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-5 pb-24 sm:px-6 lg:px-8 lg:pb-8">
      <Link
        href="/aquaculture"
        className="inline-flex items-center gap-1 text-sm font-medium text-teal-800 hover:text-teal-950"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Aquaculture
      </Link>

      {/* Hero */}
      <header className="mt-4 overflow-hidden rounded-2xl border border-teal-200/60 bg-gradient-to-br from-slate-900 via-teal-950 to-emerald-950 p-5 text-white shadow-xl sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-teal-200">
              <Bot className="h-3.5 w-3.5" aria-hidden />
              AI feeding advisor
            </p>
            <h1 className="mt-1 flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight sm:text-3xl">
              <UtensilsCrossed className="h-7 w-7 text-teal-300" strokeWidth={1.75} aria-hidden />
              Daily feed plans
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-teal-100/90">
              WorldFish-based rations from pond biomass. Generate → review → approve → apply to warehouse or expense.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/aquaculture/sampling"
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold backdrop-blur hover:bg-white/20"
            >
              <Gauge className="h-3.5 w-3.5" aria-hidden />
              Sampling
            </Link>
            <Link
              href="/aquaculture/ponds"
              className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold backdrop-blur hover:bg-white/20"
            >
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              Ponds
            </Link>
            <button
              type="button"
              onClick={() => void loadList()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-teal-900 hover:bg-teal-50 disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <PipelineStatCard
            title="Needs review"
            value={pipelineStats.pending}
            sub="Draft plans"
            icon={Sparkles}
            tone="amber"
            active={filterStatus === 'pending_review'}
            onClick={() => setFilterStatus('pending_review')}
          />
          <PipelineStatCard
            title="Approved"
            value={pipelineStats.approved}
            sub="Ready to apply"
            icon={ClipboardList}
            tone="sky"
            active={filterStatus === 'approved'}
            onClick={() => setFilterStatus('approved')}
          />
          <PipelineStatCard
            title="Applied"
            value={pipelineStats.applied}
            sub="Executed"
            icon={CheckCircle2}
            tone="emerald"
            active={filterStatus === 'applied'}
            onClick={() => setFilterStatus('applied')}
          />
          <PipelineStatCard
            title="All plans"
            value={pipelineStats.total}
            sub="Recent records"
            icon={List}
            tone="slate"
            active={filterStatus === 'all'}
            onClick={() => setFilterStatus('all')}
          />
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-12 lg:items-start">
        {/* Left: generate + list */}
        <div className="space-y-4 lg:col-span-5 xl:col-span-5">
          <section className="rounded-2xl border border-teal-200/70 bg-white p-4 shadow-sm ring-1 ring-teal-500/10">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Sparkles className="h-4 w-4 text-teal-600" aria-hidden />
              New daily plan
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-medium text-slate-600 sm:col-span-2">
                Pond
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-2 text-sm"
                  value={genPond}
                  onChange={(e) => setGenPond(e.target.value)}
                >
                  <option value="">Select pond…</option>
                  {ponds.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              {pendingPonds.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 sm:col-span-2">
                  <span className="w-full text-[10px] font-medium uppercase text-slate-500">Today needs review</span>
                  {pendingPonds.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setGenPond(String(p.id))}
                      className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100"
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              ) : null}
              <label className="block text-xs font-medium text-slate-600">
                Date
                <input
                  type="date"
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-2 text-sm"
                  value={genDate}
                  onChange={(e) => setGenDate(e.target.value)}
                />
              </label>
              <label className="block text-xs font-medium text-slate-600">
                Sack size
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-2 text-sm"
                  value={genSackKg}
                  onChange={(e) => {
                    const v = Number.parseInt(e.target.value, 10)
                    if (isAllowedSackKg(v)) setGenSackKg(v)
                  }}
                >
                  {SACK_SIZE_OPTIONS_KG.map((kg) => (
                    <option key={kg} value={kg}>
                      {kg} kg
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button
              type="button"
              className="mt-2 flex w-full items-center justify-center gap-1 text-xs font-medium text-teal-800"
              onClick={() => setShowAdvancedGen((v) => !v)}
            >
              Advanced options
              <ChevronDown className={`h-3.5 w-3.5 transition ${showAdvancedGen ? 'rotate-180' : ''}`} aria-hidden />
            </button>
            {showAdvancedGen ? (
              <div className="mt-2 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
                <label className="block text-xs font-medium text-slate-600 sm:col-span-2">
                  Production cycle
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-2 text-sm disabled:opacity-50"
                    value={genCycle}
                    onChange={(e) => setGenCycle(e.target.value)}
                    disabled={!genPond}
                  >
                    <option value="">All movements</option>
                    {cycles.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs font-medium text-slate-600 sm:col-span-2">
                  Water °C (optional)
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="e.g. 28"
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-2 text-sm"
                    value={genTemp}
                    onChange={(e) => setGenTemp(e.target.value)}
                  />
                </label>
              </div>
            ) : null}
            <button
              type="button"
              disabled={genBusy || !genPond}
              onClick={() => void generate()}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-700 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              {genBusy ? 'Generating…' : 'Generate AI plan'}
            </button>
          </section>

          <div className="rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm">
            <StatusFilterTabs
              filterStatus={filterStatus}
              statusTabCounts={statusTabCounts}
              onChange={setFilterStatus}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <select
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-1.5 text-xs"
                value={filterPond}
                onChange={(e) => setFilterPond(e.target.value)}
              >
                <option value="">All ponds</option>
                {ponds.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setTodayOnly((v) => !v)}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                  todayOnly ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-700'
                }`}
              >
                Today
              </button>
            </div>
            <label className="mt-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
              <input
                ref={searchRef}
                type="search"
                placeholder="Search… (press /)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                autoComplete="off"
              />
            </label>
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <div className="h-9 w-9 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-slate-600">
              <p className="font-medium text-slate-800">No plans yet</p>
              <p className="mt-1 text-xs">Generate your first daily plan above.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">Daily plans</h2>
                <p className="text-xs text-slate-500">
                  {displayRows.length} of {rows.length}
                  {todayOnly || searchQuery || filterPond || filterStatus !== 'all' ? ' · filtered' : ''}
                </p>
              </div>
              <div className="max-h-[min(70vh,720px)] space-y-2.5 overflow-y-auto pr-0.5">
                {displayRows.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                    No matches.{' '}
                    <button
                      type="button"
                      className="font-medium text-teal-800 underline"
                      onClick={() => {
                        setSearchQuery('')
                        setTodayOnly(false)
                      }}
                    >
                      Clear filters
                    </button>
                  </p>
                ) : (
                  listDisplayRows.map((r) => (
                    <AdvicePlanCard
                      key={r.id}
                      row={r}
                      selected={selected?.id === r.id}
                      onSelect={() => setSelected(rows.find((x) => x.id === r.id) ?? r)}
                    />
                  ))
                )}
              </div>
            </>
          )}

          <div className="hidden lg:block">
            <PageTipsAside />
          </div>
        </div>

        {/* Right: detail */}
        <div className="lg:col-span-7 xl:col-span-7">
          {!selected ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/80 px-6 py-16 text-center">
              <Bot className="h-12 w-12 text-slate-300" aria-hidden />
              <p className="mt-4 text-sm font-semibold text-slate-800">Select a plan</p>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-slate-500">
                Pick a row from the list or generate a new AI daily plan for a pond.
              </p>
            </div>
          ) : (
            <div className="space-y-4 lg:sticky lg:top-4">
              <FeedingInsightHero
                row={selected}
                weatherLabel={weatherLabel}
                mealsLabel={mealsLabel}
                feedKgOverride={
                  selected.status === 'pending_review' || selected.status === 'approved' ? activeDoseKg || null : null
                }
              />

              {(selected.status === 'pending_review' || selected.status === 'approved') && (
                <FeedingDoseEditor
                  kg={selected.status === 'pending_review' ? editKg : applyKg}
                  sacks={selected.status === 'pending_review' ? editSacks : applySacks}
                  sackKg={sackKgForDisplay}
                  suggestedKg={selected.suggested_feed_kg}
                  onKgChange={selected.status === 'pending_review' ? onEditKgChange : onApplyKgChange}
                  onSacksChange={selected.status === 'pending_review' ? onEditSacksChange : onApplySacksChange}
                  onUseSuggested={resetToSuggestedDose}
                  sackSelect={sackSelect}
                  hint={
                    selected.status === 'approved'
                      ? 'Adjust field kg before apply, or use the AI suggested total. Meal rows below scale to your total while keeping the advised per-meal ratio.'
                      : undefined
                  }
                  footer={
                    selected.status === 'approved' ? (
                      <button
                        type="button"
                        disabled={sackSaveBusy}
                        onClick={() => void saveSackSizeOnly()}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800"
                      >
                        {sackSaveBusy ? 'Saving…' : 'Save sack size'}
                      </button>
                    ) : undefined
                  }
                />
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <div className="min-w-0 text-xs text-slate-500">
                  <Link href={`/aquaculture/ponds/${selected.pond_id}`} className="font-semibold text-teal-900 hover:underline">
                    {selected.pond_name}
                  </Link>
                  {selected.production_cycle_name ? ` · ${selected.production_cycle_name}` : ''}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/aquaculture/ponds/${selected.pond_id}`}
                    className="hidden items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 sm:inline-flex"
                  >
                    Pond <ArrowRight className="h-3 w-3" aria-hidden />
                  </Link>
                  {selected.status === 'cancelled' ? (
                    <button
                      type="button"
                      disabled={deleteBusy}
                      onClick={() => void deleteCancelled()}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-900"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      Delete
                    </button>
                  ) : null}
                  <span className={statusPill(selected.status)}>{selected.status_label}</span>
                </div>
              </div>

              <WorkflowRail status={selected.status} />

              {selectedHiddenBySearch ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                  Hidden by filters — clear search or filters to see this row in the list.
                </p>
              ) : null}

              {displayMealPlan.rows.length > 0 ? (
                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-slate-900">Meal schedule</h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Per-meal kg and sacks ({sackKgForDisplay} kg/sack)
                    {mealPlanScaled ? ' · scaled to your daily total using the advised per-meal ratio' : ''}
                  </p>
                  <div className="mt-3">
                    <MealPlanTable
                      rows={displayMealPlan.rows}
                      totalKg={displayMealPlan.totalKg}
                      sackKg={sackKgForDisplay}
                      appliedKg={selected.status === 'applied' ? selected.applied_feed_kg : null}
                    />
                  </div>
                  {feedingScheduleBlock?.per_meal_amount_summary != null ? (
                    <p className="mt-2 text-xs text-slate-600">
                      <AdviceRichText text={String(feedingScheduleBlock.per_meal_amount_summary)} />
                    </p>
                  ) : null}
                </section>
              ) : null}

              {feedingScheduleBullets.length > 0 ? (
                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="text-xs font-semibold uppercase text-slate-500">Pond notes</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-700">
                    {feedingScheduleBullets.map((b, i) => (
                      <li key={i}>
                        <AdviceRichText text={b} />
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <summary className="cursor-pointer text-xs font-semibold text-slate-600">AI narrative (full text)</summary>
                <div className="mt-2 max-h-40 overflow-y-auto rounded-lg bg-slate-50 p-3">
                  <AdviceRichText text={selected.effective_advice_text || selected.ai_advice_text} />
                </div>
              </details>

              {worldfishBlock ? (
                <details className="rounded-xl border border-teal-100 bg-teal-50/40 p-3 text-xs">
                  <summary className="cursor-pointer font-semibold text-teal-950">WorldFish parameters</summary>
                  <dl className="mt-2 grid gap-1 sm:grid-cols-2">
                    {worldfishBlock.worldfish_stage != null && (
                      <>
                        <dt className="text-slate-500">Stage</dt>
                        <dd>{String(worldfishBlock.worldfish_stage)}</dd>
                      </>
                    )}
                    {worldfishBlock.mean_fish_weight_g != null && (
                      <>
                        <dt className="text-slate-500">Mean weight</dt>
                        <dd>{String(worldfishBlock.mean_fish_weight_g)} g</dd>
                      </>
                    )}
                    <dt className="text-slate-500">% BW / day</dt>
                    <dd>{String(worldfishBlock.chosen_bw_pct_per_day)}%</dd>
                  </dl>
                </details>
              ) : null}

              {selected.status === 'pending_review' && (
                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-slate-900">Review & approve</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Save your feed amount above, add optional notes, then approve for field use.
                  </p>
                  <textarea
                    className="mt-2 min-h-[100px] w-full rounded-lg border border-slate-300 p-3 text-sm"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    placeholder="Optional manager notes…"
                  />
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={saveBusy}
                      onClick={() => void saveEdits()}
                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    >
                      {saveBusy ? 'Saving…' : 'Save draft'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void approve()}
                      className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white"
                    >
                      <Check className="h-4 w-4" aria-hidden />
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => void cancelAdvice()}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
                    >
                      <XCircle className="h-4 w-4" aria-hidden />
                      Cancel
                    </button>
                  </div>
                </section>
              )}

              {selected.status === 'approved' && (
                <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-emerald-950">Apply in field</h3>
                  <p className="mt-1 text-xs text-emerald-900/90">
                    Feed amount is set above. Consume pond warehouse stock or record a feed purchase expense.
                  </p>
                  <label className="mt-3 block text-xs font-medium text-slate-700">
                    Feed product
                    <select
                      className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                      value={applyFeedItemId}
                      onChange={(e) => setApplyFeedItemId(e.target.value)}
                    >
                      <option value="">
                        {selected.pond_default_feed_item_id
                          ? `Default: ${selected.pond_default_feed_item_name || 'feed'}`
                          : 'Choose warehouse item…'}
                      </option>
                      {pondWhStock.map((row) => (
                        <option key={row.item_id} value={String(row.item_id)}>
                          {row.item_name} ({row.quantity} {row.unit})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="mt-2 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={applyConsumePond && !applyCreateExp}
                      disabled={applyCreateExp}
                      onChange={(e) => setApplyConsumePond(e.target.checked)}
                    />
                    <span>
                      <span className="font-medium text-slate-900">Consume pond warehouse</span>
                      <span className="block text-xs font-normal text-slate-600">
                        Reduces sacks on hand at this pond (recommended when using transferred feed).
                      </span>
                    </span>
                  </label>
                  <label className="mt-2 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={applyCreateExp}
                      onChange={(e) => {
                        setApplyCreateExp(e.target.checked)
                        if (e.target.checked) setApplyConsumePond(false)
                      }}
                    />
                    <span>
                      <span className="font-medium text-slate-900">Record feed purchase expense</span>
                      <span className="block text-xs font-normal text-slate-600">
                        Shop/cost entry only — does <strong>not</strong> change pond warehouse quantity.
                      </span>
                    </span>
                  </label>
                  {applyCreateExp ? (
                    <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">
                      Pond warehouse will stay at the current on-hand figure (e.g. 50 sacks) with this option. Use
                      “Consume pond warehouse” to deduct applied feed from the pond.
                    </p>
                  ) : !applyConsumePond ? (
                    <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      Neither stock nor purchase expense will be recorded — only the feeding advice status changes.
                    </p>
                  ) : null}
                  {applyCreateExp && (
                    <div className="mt-3 space-y-2">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={applyManualPurchaseAmount}
                          onChange={(e) => setApplyManualPurchaseAmount(e.target.checked)}
                        />
                        Override amount
                      </label>
                      {purchaseAmountEstimateLabel && !applyManualPurchaseAmount ? (
                        <p className="rounded-lg border bg-white px-3 py-2 text-xs">{purchaseAmountEstimateLabel}</p>
                      ) : null}
                      {applyManualPurchaseAmount ? (
                        <input
                          type="text"
                          placeholder={`Amount (${sym})`}
                          className="w-full rounded-lg border px-3 py-2 text-sm"
                          value={applyAmount}
                          onChange={(e) => setApplyAmount(e.target.value)}
                        />
                      ) : null}
                      <input
                        type="text"
                        placeholder="Vendor"
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        value={applyVendor}
                        onChange={(e) => setApplyVendor(e.target.value)}
                      />
                    </div>
                  )}
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={applyBusy || applyPlanBlockedByWarehouseLoad}
                      onClick={() => void apply()}
                      className="rounded-lg bg-emerald-600 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {applyBusy ? 'Applying…' : applyPlanBlockedByWarehouseLoad ? 'Loading stock…' : 'Apply plan'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void disapproveAdvice()}
                      className="inline-flex items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-950"
                    >
                      Revoke approval
                    </button>
                    <button
                      type="button"
                      onClick={() => void cancelAdvice()}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
                    >
                      <XCircle className="h-4 w-4" aria-hidden />
                      Cancel plan
                    </button>
                  </div>
                </section>
              )}

              {selected.status === 'applied' && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <p>
                    Applied <strong>{selected.applied_feed_kg ?? '—'} kg</strong>
                    {feedKgToSackLabel(selected.applied_feed_kg, sackKgForDisplay)
                      ? ` (${feedKgToSackLabel(selected.applied_feed_kg, sackKgForDisplay)})`
                      : ''}
                    {selected.applied_by_display ? ` · ${selected.applied_by_display}` : ''}
                    {selected.applied_at ? ` · ${formatDateOnly(selected.applied_at)}` : ''}
                  </p>
                  {selected.linked_expense_category === 'feed_consumed' ? (
                    <p className="mt-1 text-xs font-medium text-emerald-800">
                      Pond warehouse stock was reduced (feed consumed).
                    </p>
                  ) : selected.linked_expense_category === 'feed_purchase' ? (
                    <p className="mt-1 text-xs font-medium text-amber-900">
                      Purchase expense only — pond warehouse on-hand was not reduced. Apply again with “Consume pond
                      warehouse” to deduct sacks.
                    </p>
                  ) : !selected.linked_expense_id ? (
                    <p className="mt-1 text-xs text-slate-600">No linked expense / stock movement.</p>
                  ) : null}
                  <p className="mt-2 text-xs text-slate-600">
                    Applied feeding advice cannot be deleted (audit trail). To undo accounting or stock, delete the
                    linked expense below. Revoke approval or cancel plan only while status is review or approved (not
                    applied).
                  </p>
                  {selected.linked_expense_id ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Link
                        href={`/aquaculture/expenses?pond_id=${selected.pond_id}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
                      >
                        Open expenses for {selected.pond_name}
                        <ArrowRight className="h-3 w-3" aria-hidden />
                      </Link>
                      <button
                        type="button"
                        disabled={deleteLinkedExpenseBusy}
                        onClick={() => void deleteLinkedExpense()}
                        className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-900 hover:bg-red-100 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        {deleteLinkedExpenseBusy
                          ? 'Deleting…'
                          : `Delete linked expense #${selected.linked_expense_id}`}
                      </button>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">
                      Linked expense already removed. You can record a new apply with the correct options if needed.
                    </p>
                  )}
                  <div className="mt-4 border-t border-slate-200 pt-3">
                    {sackSelect}
                    <button
                      type="button"
                      disabled={sackSaveBusy}
                      onClick={() => void saveSackSizeOnly()}
                      className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                    >
                      {sackSaveBusy ? 'Saving…' : 'Save sack size'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mobile sticky actions */}
      {selected?.status === 'pending_review' ? (
        <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-slate-200 bg-white/95 p-3 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => void saveEdits()}
            disabled={saveBusy}
            className="flex-1 rounded-lg border border-slate-300 py-2.5 text-sm font-medium"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => void approve()}
            className="flex-1 rounded-lg bg-sky-600 py-2.5 text-sm font-semibold text-white"
          >
            Approve
          </button>
        </div>
      ) : null}
      {selected?.status === 'approved' ? (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 backdrop-blur lg:hidden">
          <button
            type="button"
            disabled={applyBusy || applyPlanBlockedByWarehouseLoad}
            onClick={() => void apply()}
            className="w-full rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {applyBusy ? 'Applying…' : 'Apply plan'}
          </button>
        </div>
      ) : null}
    </div>
  )
}



