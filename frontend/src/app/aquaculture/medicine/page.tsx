'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  MapPin,
  Package,
  Pill,
  Plus,
  RefreshCw,
  Stethoscope,
} from 'lucide-react'
import { AquaculturePageShell } from '@/components/aquaculture/AquaculturePageShell'
import { AQ_HERO_BTN_GHOST, AQ_HERO_BTN_PRIMARY, AQ_HERO_LINK, PipelineStatCard } from '@/components/aquaculture/AquacultureUi'
import { useToast } from '@/components/Toast'
import { usePageMeta } from '@/hooks/usePageMeta'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { productOptionLabel } from '@/lib/aquacultureMedicineUnits'
import {
  buildKgPerDecimalDoseHint,
  buildMedicineDoseSuggestion,
  parsePondWaterAreaDecimal,
  formatMedicineQuantity,
  totalKgForKgPerDecimalRate,
} from '@/lib/aquacultureMedicineDoseGuide'
import { formatTreatmentWaterVolume } from '@/lib/aquaculturePondVolume'
import {
  buildTreatmentMemoForLine,
  isoToday,
  isBuiltinMedicineSku,
  isMedicineItem,
  makeBatchRef,
  monthStartIso,
  newMedicineProductLine,
  validateMedicineProductLines,
  type MedicineProductLine,
  type TreatmentFormFields,
} from './medicineUtils'
import {
  MedicineHistoryTable,
  MedicineTreatmentDeleteDialog,
  MedicineTipsAside,
  type MedicineHistoryRow,
} from './MedicineUi'
import { MedicineTreatmentEditModal } from './MedicineTreatmentEditModal'
import { MedicineTreatmentEntryModal } from './MedicineTreatmentEntryModal'

interface Pond {
  id: number
  name: string
  default_medicine_item_id?: number | null
  default_medicine_item_name?: string
  water_area_decimal?: string | null
  pond_depth_ft?: string | null
  water_volume_cu_ft?: string | null
  water_surface_sq_ft?: string | null
}

interface CycleRow {
  id: number
  name: string
}

interface ItemPickRow {
  id: number
  name: string
  item_number?: string
  item_type?: string
  pos_category?: string
  category?: string
  unit?: string
}

interface WarehouseStockRow {
  item_id: number
  item_name: string
  quantity: string
  unit: string
  pos_category?: string
  unit_cost?: string
}

interface ConsumptionRow extends MedicineHistoryRow {
  kind: 'feed' | 'medicine'
  pond_id: number
  item_id?: number | null
}

const EMPTY_TREATMENT: TreatmentFormFields = {
  purpose: '',
  method: '',
  doseAmount: '',
  doseUnit: '',
  waterVolume: '',
  withdrawalDays: '',
  appliedBy: '',
  notes: '',
}

const labelCls = 'block text-xs font-medium text-slate-700'
const selectCls =
  'rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20'

function AquacultureMedicinePageInner() {
  const pageMeta = usePageMeta()
  const toast = useToast()
  const searchParams = useSearchParams()
  const initialPond = searchParams.get('pond_id') ?? ''

  const [ponds, setPonds] = useState<Pond[]>([])
  const [filterPond, setFilterPond] = useState(initialPond)
  const [entryPondId, setEntryPondId] = useState('')
  const [entryModal, setEntryModal] = useState(false)
  const [cycles, setCycles] = useState<CycleRow[]>([])
  const [inventoryItems, setInventoryItems] = useState<ItemPickRow[]>([])
  const [warehouseRows, setWarehouseRows] = useState<WarehouseStockRow[]>([])
  const [ledger, setLedger] = useState<ConsumptionRow[]>([])
  const [currency, setCurrency] = useState('BDT')
  const [loading, setLoading] = useState(true)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [whLoading, setWhLoading] = useState(false)

  const [showDefaultSku, setShowDefaultSku] = useState(false)
  const [defaultMedSel, setDefaultMedSel] = useState('')
  const [defaultMedSaving, setDefaultMedSaving] = useState(false)

  const [productLines, setProductLines] = useState<MedicineProductLine[]>(() => [newMedicineProductLine()])
  const [medDate, setMedDate] = useState(isoToday)
  const [medCycleId, setMedCycleId] = useState('')
  const [treatment, setTreatment] = useState<TreatmentFormFields>({ ...EMPTY_TREATMENT })
  const [medSaving, setMedSaving] = useState(false)

  const [historyFrom, setHistoryFrom] = useState(monthStartIso)
  const [historyTo, setHistoryTo] = useState(isoToday)
  const [editRow, setEditRow] = useState<MedicineHistoryRow | null>(null)
  const [deleteRow, setDeleteRow] = useState<MedicineHistoryRow | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [busyRowId, setBusyRowId] = useState<number | null>(null)
  const waterVolumeEditedRef = useRef(false)
  const treatmentFieldsEditedRef = useRef(false)
  const [doseSuggestionLabel, setDoseSuggestionLabel] = useState<string | null>(null)

  const filterPondNum = filterPond.trim() !== '' ? Number.parseInt(filterPond, 10) : NaN
  const entryPondNum = entryPondId.trim() !== '' ? Number.parseInt(entryPondId, 10) : NaN
  const selectedFilterPond = ponds.find((p) => p.id === filterPondNum) ?? null
  const selectedEntryPond = ponds.find((p) => p.id === entryPondNum) ?? null

  const medicineCatalog = useMemo(() => {
    const meds = inventoryItems.filter(isMedicineItem)
    const list = meds.length > 0 ? meds : inventoryItems
    return [...list].sort((a, b) => {
      const aBuilt = isBuiltinMedicineSku(a.item_number) ? 0 : 1
      const bBuilt = isBuiltinMedicineSku(b.item_number) ? 0 : 1
      if (aBuilt !== bBuilt) return aBuilt - bBuilt
      return a.name.localeCompare(b.name)
    })
  }, [inventoryItems])

  const applyDoseSuggestionForLine = useCallback(
    (lineId: string, itemId: string) => {
      const item = medicineCatalog.find((c) => String(c.id) === itemId)
      if (!item) return
      const sug = buildMedicineDoseSuggestion(
        item.name,
        item.category,
        selectedEntryPond ?? undefined,
        item.item_number,
      )
      if (!sug) {
        setDoseSuggestionLabel(null)
        return
      }
      if (!treatmentFieldsEditedRef.current) {
        const waterVol = selectedEntryPond ? formatTreatmentWaterVolume(selectedEntryPond) : null
        setTreatment((prev) => ({
          ...prev,
          purpose: sug.treatment.purpose ?? prev.purpose,
          method: sug.treatment.method ?? prev.method,
          doseAmount: sug.treatment.doseAmount ?? prev.doseAmount,
          doseUnit: sug.treatment.doseUnit ?? prev.doseUnit,
          withdrawalDays: sug.treatment.withdrawalDays ?? prev.withdrawalDays,
          notes: sug.treatment.notes ?? prev.notes,
          waterVolume: waterVolumeEditedRef.current ? prev.waterVolume : waterVol ?? prev.waterVolume,
        }))
      }
      setDoseSuggestionLabel(sug.guide.name)
      if (sug.quantity || sug.lineNote) {
        setProductLines((prev) =>
          prev.map((l) =>
            l.id === lineId
              ? {
                  ...l,
                  quantity: sug.quantity && !l.quantity.trim() ? sug.quantity : l.quantity,
                  lineNote: sug.lineNote && !l.lineNote.trim() ? sug.lineNote : l.lineNote,
                }
              : l,
          ),
        )
      }
    },
    [medicineCatalog, selectedEntryPond],
  )

  const loadPonds = useCallback(async () => {
    try {
      await api.post('/aquaculture/medicine-catalog/ensure/').catch(() => null)
      const [pondsRes, coRes, itemsRes] = await Promise.all([
        api.get<Pond[]>('/aquaculture/ponds/'),
        api.get<Record<string, unknown>>('/companies/current/'),
        api.get<ItemPickRow[]>('/items/', { params: { pos_only: 'true' } }).catch(() => ({ data: [] })),
      ])
      setPonds(Array.isArray(pondsRes.data) ? pondsRes.data : [])
      setCurrency(String(coRes.data?.currency || 'BDT').slice(0, 3))
      const raw = Array.isArray(itemsRes.data) ? itemsRes.data : []
      setInventoryItems(raw.filter((it) => (it.item_type || '').toLowerCase() === 'inventory'))
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load ponds'))
    } finally {
      setLoading(false)
    }
  }, [toast])

  const loadLedger = useCallback(async () => {
    setLedgerLoading(true)
    try {
      const params: Record<string, string> = { kind: 'medicine', limit: '300' }
      if (Number.isFinite(filterPondNum)) params.pond_id = String(filterPondNum)
      if (historyFrom) params.date_from = historyFrom
      if (historyTo) params.date_to = historyTo
      const { data } = await api.get<{ rows?: ConsumptionRow[] }>(
        '/aquaculture/pond-warehouse-consumption-ledger/',
        { params },
      )
      setLedger(Array.isArray(data?.rows) ? data.rows : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load treatment history'))
      setLedger([])
    } finally {
      setLedgerLoading(false)
    }
  }, [toast, filterPondNum, historyFrom, historyTo])

  const loadWarehouse = useCallback(async (pondNum: number) => {
    if (!Number.isFinite(pondNum)) {
      setWarehouseRows([])
      return
    }
    setWhLoading(true)
    try {
      const { data } = await api.get<{ items?: WarehouseStockRow[] }>(
        `/aquaculture/ponds/${pondNum}/warehouse-stock/`,
      )
      setWarehouseRows(Array.isArray(data?.items) ? data.items : [])
    } catch {
      setWarehouseRows([])
    } finally {
      setWhLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPonds()
  }, [loadPonds])

  useEffect(() => {
    if (initialPond && !filterPond) setFilterPond(initialPond)
  }, [initialPond, filterPond])

  useEffect(() => {
    void loadLedger()
  }, [loadLedger])

  useEffect(() => {
    const pondForDefault = Number.isFinite(filterPondNum) ? filterPondNum : NaN
    if (!Number.isFinite(pondForDefault)) {
      setDefaultMedSel('')
      return
    }
    const p = ponds.find((x) => x.id === pondForDefault)
    if (p?.default_medicine_item_id != null) {
      setDefaultMedSel(String(p.default_medicine_item_id))
    } else {
      setDefaultMedSel('')
    }
  }, [filterPondNum, ponds])

  useEffect(() => {
    if (entryModal && Number.isFinite(entryPondNum)) return
    if (Number.isFinite(filterPondNum)) void loadWarehouse(filterPondNum)
    else setWarehouseRows([])
  }, [filterPondNum, entryModal, entryPondNum, loadWarehouse])

  useEffect(() => {
    if (!entryModal) return
    if (!Number.isFinite(entryPondNum)) {
      setCycles([])
      return
    }
    void (async () => {
      try {
        const { data } = await api.get<CycleRow[]>('/aquaculture/production-cycles/', {
          params: { pond_id: entryPondNum },
        })
        setCycles(Array.isArray(data) ? data : [])
      } catch {
        setCycles([])
      }
    })()
    const p = ponds.find((x) => x.id === entryPondNum)
    if (p?.default_medicine_item_id != null) {
      const line = newMedicineProductLine(String(p.default_medicine_item_id))
      setProductLines([line])
      queueMicrotask(() => applyDoseSuggestionForLine(line.id, String(p.default_medicine_item_id)))
    } else {
      setProductLines([newMedicineProductLine()])
    }
    void loadWarehouse(entryPondNum)
  }, [entryModal, entryPondNum, ponds, loadWarehouse, applyDoseSuggestionForLine])

  useEffect(() => {
    if (!entryModal || !selectedEntryPond || waterVolumeEditedRef.current) return
    const filled = formatTreatmentWaterVolume(selectedEntryPond)
    setTreatment((prev) => ({
      ...prev,
      waterVolume: filled ?? '',
    }))
  }, [entryModal, selectedEntryPond])

  const medicineOnHand = useMemo(() => {
    const medIds = new Set(medicineCatalog.map((i) => i.id))
    return warehouseRows
      .filter((r) => medIds.has(r.item_id) && Number.parseFloat(r.quantity) > 0)
      .sort((a, b) => a.item_name.localeCompare(b.item_name))
  }, [warehouseRows, medicineCatalog])

  const stockByItemId = useMemo(() => {
    const m = new Map<number, { quantity: string; unit: string }>()
    for (const r of medicineOnHand) {
      m.set(r.item_id, { quantity: r.quantity, unit: r.unit })
    }
    return m
  }, [medicineOnHand])

  const filledLineCount = useMemo(
    () => productLines.filter((l) => l.itemId.trim() !== '' && l.quantity.trim() !== '').length,
    [productLines],
  )

  const kgPerDecimalDoseHint = useMemo(
    () =>
      treatment.doseUnit === 'kg_decimal'
        ? buildKgPerDecimalDoseHint(selectedEntryPond, treatment.doseAmount)
        : null,
    [treatment.doseUnit, treatment.doseAmount, selectedEntryPond],
  )

  useEffect(() => {
    if (!entryModal || treatment.doseUnit !== 'kg_decimal') return
    const dec = parsePondWaterAreaDecimal(selectedEntryPond)
    const rate = Number.parseFloat(treatment.doseAmount.replace(/,/g, ''))
    if (dec == null || !Number.isFinite(rate) || rate <= 0) return
    const qtyStr = formatMedicineQuantity(Math.max(0.1, totalKgForKgPerDecimalRate(rate, dec)))
    setProductLines((prev) => {
      let changed = false
      const next = prev.map((l) => {
        if (!l.itemId.trim() || l.quantity.trim()) return l
        changed = true
        return { ...l, quantity: qtyStr }
      })
      return changed ? next : prev
    })
  }, [entryModal, treatment.doseUnit, treatment.doseAmount, selectedEntryPond])

  const monthStats = useMemo(() => {
    const start = monthStartIso()
    let count = 0
    let total = 0
    for (const r of ledger) {
      if (r.entry_date >= start) {
        count += 1
        total += Number(r.amount) || 0
      }
    }
    return { count, total }
  }, [ledger])

  const sym = getCurrencySymbol(currency)
  const showPondColumn = !Number.isFinite(filterPondNum)

  const resetEntryForm = useCallback(
    (pondId: string) => {
      setEntryPondId(pondId)
      setMedDate(isoToday())
      setMedCycleId('')
      setTreatment({ ...EMPTY_TREATMENT })
      setDoseSuggestionLabel(null)
      waterVolumeEditedRef.current = false
      treatmentFieldsEditedRef.current = false
      const p = ponds.find((x) => String(x.id) === pondId)
      if (p?.default_medicine_item_id != null) {
        setProductLines([newMedicineProductLine(String(p.default_medicine_item_id))])
      } else {
        setProductLines([newMedicineProductLine()])
      }
      if (p) {
        const filled = formatTreatmentWaterVolume(p)
        if (filled) setTreatment((prev) => ({ ...prev, waterVolume: filled }))
      }
    },
    [ponds],
  )

  const openNewTreatment = () => {
    const defaultPond =
      filterPond && ponds.some((p) => String(p.id) === filterPond)
        ? filterPond
        : ponds[0]
          ? String(ponds[0].id)
          : ''
    resetEntryForm(defaultPond)
    setEntryModal(true)
  }

  const closeEntryModal = () => {
    if (medSaving) return
    setEntryModal(false)
  }

  const saveDefaultMedicine = async () => {
    if (!Number.isFinite(filterPondNum)) {
      toast.error('Select a pond in the filter to set its default medicine')
      return
    }
    setDefaultMedSaving(true)
    try {
      const body =
        defaultMedSel === ''
          ? { default_medicine_item_id: null }
          : { default_medicine_item_id: Number.parseInt(defaultMedSel, 10) }
      if (defaultMedSel !== '' && !Number.isFinite(body.default_medicine_item_id as number)) {
        toast.error('Pick a valid medicine product')
        setDefaultMedSaving(false)
        return
      }
      await api.put(`/aquaculture/ponds/${filterPondNum}/`, body)
      toast.success('Default medicine saved for this pond')
      void loadPonds()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not save'))
    } finally {
      setDefaultMedSaving(false)
    }
  }

  const updateProductLine = (id: string, patch: Partial<MedicineProductLine>) => {
    if ('quantity' in patch || 'lineNote' in patch) treatmentFieldsEditedRef.current = true
    setProductLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  const addProductLine = () => {
    setProductLines((prev) => [...prev, newMedicineProductLine()])
  }

  const removeProductLine = (id: string) => {
    setProductLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.id !== id)))
  }

  const assignProductFromStock = (itemId: number) => {
    const idStr = String(itemId)
    setProductLines((prev) => {
      const empty = prev.find((l) => !l.itemId.trim())
      const targetId = empty?.id ?? prev[0]?.id
      const next = empty
        ? prev.map((l) => (l.id === empty.id ? { ...l, itemId: idStr } : l))
        : prev.map((l, i) => (i === 0 ? { ...l, itemId: idStr } : l))
      if (targetId) queueMicrotask(() => applyDoseSuggestionForLine(targetId, idStr))
      return next
    })
  }

  const recordMedicine = async () => {
    if (!Number.isFinite(entryPondNum)) {
      toast.error('Select a pond')
      return
    }
    const check = validateMedicineProductLines(productLines, medicineCatalog, stockByItemId)
    if (!check.ok) {
      toast.error(check.message)
      return
    }
    const { validated } = check
    const total = validated.length
    const batchRef = total > 1 ? makeBatchRef(medDate) : null

    setMedSaving(true)
    let recorded = 0
    try {
      for (let i = 0; i < validated.length; i++) {
        const row = validated[i]
        const memo = buildTreatmentMemoForLine(treatment, {
          batchRef,
          lineIndex: i + 1,
          total,
          productName: row.productName,
          quantity: String(row.quantity),
          unit: row.unit,
          lineNote: row.lineNote,
        })
        const body: Record<string, unknown> = {
          pond_id: entryPondNum,
          item_id: row.itemId,
          quantity: String(row.quantity),
          expense_category: 'medicine_consumed',
          expense_date: medDate,
          memo,
        }
        if (medCycleId.trim() !== '') {
          const c = Number.parseInt(medCycleId, 10)
          if (Number.isFinite(c)) body.production_cycle_id = c
        }
        await api.post('/aquaculture/pond-warehouse-consume/', body)
        recorded += 1
      }
      if (total === 1) {
        toast.success('Treatment recorded — stock reduced and COGS posted')
      } else {
        toast.success(
          `Recorded ${total} products in one protocol${batchRef ? ` (${batchRef})` : ''}`,
        )
      }
      setEntryModal(false)
      setTreatment({ ...EMPTY_TREATMENT })
      setDoseSuggestionLabel(null)
      waterVolumeEditedRef.current = false
      treatmentFieldsEditedRef.current = false
      if (!Number.isFinite(filterPondNum)) setFilterPond(String(entryPondNum))
      void loadLedger()
      if (Number.isFinite(filterPondNum)) void loadWarehouse(filterPondNum)
    } catch (e) {
      if (recorded > 0) {
        toast.error(
          `${extractErrorMessage(e, 'Could not finish batch')}. ${recorded} of ${total} product(s) were already saved.`,
        )
        void loadLedger()
      } else {
        toast.error(extractErrorMessage(e, 'Could not record treatment'))
      }
    } finally {
      setMedSaving(false)
    }
  }

  const setTreatmentField = <K extends keyof TreatmentFormFields>(key: K, value: TreatmentFormFields[K]) => {
    if (key === 'waterVolume') waterVolumeEditedRef.current = true
    else treatmentFieldsEditedRef.current = true
    setTreatment((prev) => ({ ...prev, [key]: value }))
  }

  const refillWaterVolumeFromPond = () => {
    if (!selectedEntryPond) return
    const filled = formatTreatmentWaterVolume(selectedEntryPond)
    if (filled) {
      waterVolumeEditedRef.current = false
      setTreatment((prev) => ({ ...prev, waterVolume: filled }))
      toast.success('Filled from pond dimensions')
    } else {
      toast.error('Set water area and depth on the pond page first')
    }
  }

  const saveTreatmentEdit = async (payload: {
    expense_date: string
    production_cycle_id: number | null
    memo: string
  }) => {
    if (!editRow) return
    setActionBusy(true)
    setBusyRowId(editRow.id)
    try {
      await api.put(`/aquaculture/expenses/${editRow.id}/`, {
        expense_date: payload.expense_date,
        production_cycle_id: payload.production_cycle_id,
        memo: payload.memo,
      })
      toast.success('Treatment updated')
      setEditRow(null)
      void loadLedger()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not update treatment'))
    } finally {
      setActionBusy(false)
      setBusyRowId(null)
    }
  }

  const confirmDeleteTreatment = async () => {
    if (!deleteRow) return
    setActionBusy(true)
    setBusyRowId(deleteRow.id)
    try {
      await api.delete(`/aquaculture/expenses/${deleteRow.id}/`)
      toast.success('Treatment deleted — stock restored')
      setDeleteRow(null)
      void loadLedger()
      if (Number.isFinite(filterPondNum)) void loadWarehouse(filterPondNum)
      else if (deleteRow.pond_name) {
        const p = ponds.find((x) => x.name === deleteRow.pond_name)
        if (p) void loadWarehouse(p.id)
      }
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not delete treatment'))
    } finally {
      setActionBusy(false)
      setBusyRowId(null)
    }
  }

  useEffect(() => {
    if (!editRow) return
    const p = ponds.find((x) => x.name === editRow.pond_name)
    if (!p) return
    void (async () => {
      try {
        const { data } = await api.get<CycleRow[]>('/aquaculture/production-cycles/', {
          params: { pond_id: p.id },
        })
        setCycles(Array.isArray(data) ? data : [])
      } catch {
        setCycles([])
      }
    })()
  }, [editRow, ponds])

  return (
    <AquaculturePageShell
      eyebrow={pageMeta.eyebrow ?? 'Pond health'}
      eyebrowIcon={Stethoscope}
      titleId="aq-medicine-title"
      title={pageMeta.title}
      titleIcon={Pill}
      description={pageMeta.description}
      maxWidthClass="max-w-[1440px]"
      actions={
        <>
          <Link href="/aquaculture/stock" className={AQ_HERO_LINK}>
            <Package className="h-3.5 w-3.5" aria-hidden />
            Pond stock
          </Link>
          <Link href="/aquaculture/ponds" className={AQ_HERO_LINK}>
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            Ponds
          </Link>
          <button
            type="button"
            onClick={() => void loadLedger()}
            disabled={ledgerLoading}
            className={AQ_HERO_BTN_GHOST}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${ledgerLoading ? 'animate-spin' : ''}`} aria-hidden />
            Refresh
          </button>
          <button
            type="button"
            onClick={openNewTreatment}
            disabled={loading || ponds.length === 0}
            className={AQ_HERO_BTN_PRIMARY}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            New treatment
          </button>
        </>
      }
      stats={
        !loading && ponds.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <PipelineStatCard
              title="This month"
              value={monthStats.count}
              sub="treatments recorded"
              icon={ClipboardList}
              tone="sky"
            />
            <PipelineStatCard
              title="Month COGS"
              value={`${sym}${formatNumber(monthStats.total, 0)}`}
              sub="medicine consumed"
              icon={Stethoscope}
              tone="emerald"
            />
            <PipelineStatCard
              title={Number.isFinite(filterPondNum) ? 'On hand (pond)' : 'In date range'}
              value={Number.isFinite(filterPondNum) ? medicineOnHand.length : ledger.length}
              sub={
                Number.isFinite(filterPondNum)
                  ? medicineOnHand.length === 1
                    ? 'SKU at pond warehouse'
                    : 'SKUs at pond warehouse'
                  : 'treatment records'
              }
              icon={Package}
              tone={Number.isFinite(filterPondNum) && medicineOnHand.length === 0 ? 'amber' : 'slate'}
            />
          </div>
        ) : undefined
      }
    >
      {loading ? (
        <div className="mt-10 flex justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
        </div>
      ) : ponds.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-5 text-sm text-amber-950">
          <p className="font-medium">Add at least one pond first</p>
          <Link href="/aquaculture/ponds" className="mt-3 inline-block font-medium text-teal-800 underline">
            Go to Ponds
          </Link>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-12 lg:items-start">
          <div className="space-y-4 lg:col-span-5 xl:col-span-5">
            <section className="rounded-2xl border border-teal-200/70 bg-white p-4 shadow-sm ring-1 ring-teal-500/10">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Plus className="h-4 w-4 text-teal-600" aria-hidden />
                Record treatment
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                Log medicine from the pond warehouse. Multi-product baths share one batch reference.
              </p>
              <label className="mt-3 block text-xs font-medium text-slate-600">
                Pond
                <select
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50/80 px-2 py-2 text-sm"
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
              </label>
              <button
                type="button"
                disabled={loading || ponds.length === 0}
                onClick={openNewTreatment}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-teal-700 disabled:opacity-50"
              >
                <Stethoscope className="h-4 w-4" aria-hidden />
                New treatment entry
              </button>
            </section>

            <div className="rounded-2xl border border-slate-200/90 bg-white p-3 shadow-sm">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">History filters</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                <label className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-slate-600">
                  <Calendar className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                  <input
                    type="date"
                    className={selectCls}
                    value={historyFrom}
                    onChange={(e) => setHistoryFrom(e.target.value)}
                    aria-label="From date"
                  />
                  <span className="text-slate-400">–</span>
                  <input
                    type="date"
                    className={selectCls}
                    value={historyTo}
                    onChange={(e) => setHistoryTo(e.target.value)}
                    aria-label="To date"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => void loadLedger()}
                disabled={ledgerLoading}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-slate-50 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${ledgerLoading ? 'animate-spin' : ''}`} aria-hidden />
                Apply date range
              </button>
            </div>

            <div className="hidden lg:block">
              <MedicineTipsAside />
            </div>
          </div>

          <div className="space-y-4 lg:col-span-7 xl:col-span-7">
            {Number.isFinite(filterPondNum) && selectedFilterPond ? (
              <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm">
                <Link
                  href={`/aquaculture/ponds/${selectedFilterPond.id}`}
                  className="font-semibold text-teal-800 hover:underline"
                >
                  {selectedFilterPond.name} — warehouse & setup
                </Link>
                {selectedFilterPond.default_medicine_item_name ? (
                  <p className="mt-1 text-xs text-slate-600">
                    Default SKU: {selectedFilterPond.default_medicine_item_name}
                  </p>
                ) : null}
              </div>
            ) : null}

            <p className="rounded-xl border border-teal-100 bg-teal-50/60 px-3 py-2.5 text-xs leading-relaxed text-teal-950">
              Standard pond-care products (lime, salt, probiotics) are built-in SKUs — pick them in{' '}
              <span className="font-medium">New treatment</span>. Dose rates auto-fill from pond water area when
              available.
            </p>

            <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm ring-1 ring-slate-200/50">
              <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-900">Treatment history</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {ledger.length} record{ledger.length === 1 ? '' : 's'}
                  {historyFrom && historyTo ? ` · ${historyFrom} – ${historyTo}` : ''}
                </p>
              </div>
              <MedicineHistoryTable
                rows={ledger}
                currency={currency}
                loading={ledgerLoading}
                showPondColumn={showPondColumn}
                busyRowId={busyRowId}
                onEdit={(row) => setEditRow(row)}
                onDelete={(row) => setDeleteRow(row)}
              />
            </div>

            <section className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm">
              <button
                type="button"
                onClick={() => setShowDefaultSku((v) => !v)}
                className="flex w-full items-center justify-between gap-2 text-left text-sm font-medium text-slate-800"
              >
                <span className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-slate-500" aria-hidden />
                  Default medicine SKU per pond (optional)
                </span>
                {showDefaultSku ? (
                  <ChevronUp className="h-4 w-4 text-slate-400" aria-hidden />
                ) : (
                  <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden />
                )}
              </button>
              {showDefaultSku ? (
                <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
                  <label className={`${labelCls} min-w-[10rem]`}>
                    Pond
                    <select
                      className={`${selectCls} mt-1 block w-full min-w-[12rem]`}
                      value={filterPond}
                      onChange={(e) => setFilterPond(e.target.value)}
                    >
                      <option value="">Select pond…</option>
                      {ponds.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={`${labelCls} min-w-[200px] flex-1`}>
                    Product
                    <select
                      className={`${selectCls} mt-1 block w-full`}
                      value={defaultMedSel}
                      onChange={(e) => setDefaultMedSel(e.target.value)}
                      disabled={!Number.isFinite(filterPondNum)}
                    >
                      <option value="">None</option>
                      {medicineCatalog.map((it) => (
                        <option key={it.id} value={it.id}>
                          {productOptionLabel(it.name, it.unit)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={defaultMedSaving || !Number.isFinite(filterPondNum)}
                    onClick={() => void saveDefaultMedicine()}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    {defaultMedSaving ? 'Saving…' : 'Save default'}
                  </button>
                </div>
              ) : null}
            </section>

            <div className="lg:hidden">
              <MedicineTipsAside />
            </div>
          </div>
        </div>
      )}

      <MedicineTreatmentEntryModal
        open={entryModal}
        ponds={ponds}
        pondId={entryPondId}
        doseSuggestionLabel={doseSuggestionLabel}
        kgPerDecimalDoseHint={kgPerDecimalDoseHint}
        onPondIdChange={(id) => {
          setEntryPondId(id)
          waterVolumeEditedRef.current = false
          treatmentFieldsEditedRef.current = false
          setDoseSuggestionLabel(null)
          setMedCycleId('')
          const p = ponds.find((x) => String(x.id) === id)
          if (p?.default_medicine_item_id != null) {
            const line = newMedicineProductLine(String(p.default_medicine_item_id))
            setProductLines([line])
            queueMicrotask(() => applyDoseSuggestionForLine(line.id, String(p.default_medicine_item_id)))
          } else {
            setProductLines([newMedicineProductLine()])
          }
          const filled = p ? formatTreatmentWaterVolume(p) : null
          setTreatment({
            ...EMPTY_TREATMENT,
            waterVolume: filled ?? '',
          })
        }}
        onProductItemSelect={applyDoseSuggestionForLine}
        cycles={cycles}
        medicineCatalog={medicineCatalog}
        stockByItemId={stockByItemId}
        medicineOnHand={medicineOnHand}
        whLoading={whLoading}
        productLines={productLines}
        treatment={treatment}
        medDate={medDate}
        medCycleId={medCycleId}
        medSaving={medSaving}
        filledLineCount={filledLineCount}
        onMedDateChange={setMedDate}
        onMedCycleIdChange={setMedCycleId}
        onTreatmentField={setTreatmentField}
        onChangeLine={updateProductLine}
        onAddLine={addProductLine}
        onRemoveLine={removeProductLine}
        onAssignFromStock={assignProductFromStock}
        onRefillWaterVolume={refillWaterVolumeFromPond}
        onRecord={() => void recordMedicine()}
        onClose={closeEntryModal}
      />

      {editRow ? (
        <MedicineTreatmentEditModal
          row={editRow}
          cycles={cycles}
          saving={actionBusy}
          onClose={() => !actionBusy && setEditRow(null)}
          onSave={(payload) => void saveTreatmentEdit(payload)}
        />
      ) : null}
      {deleteRow ? (
        <MedicineTreatmentDeleteDialog
          row={deleteRow}
          currency={currency}
          deleting={actionBusy}
          onCancel={() => !actionBusy && setDeleteRow(null)}
          onConfirm={() => void confirmDeleteTreatment()}
        />
      ) : null}
    </AquaculturePageShell>
  )
}

export default function AquacultureMedicinePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
        </div>
      }
    >
      <AquacultureMedicinePageInner />
    </Suspense>
  )
}
