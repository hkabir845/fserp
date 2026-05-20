'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  ArrowLeft,
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
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { formatStockUnit, productOptionLabel } from '@/lib/aquacultureMedicineUnits'
import {
  formatTreatmentWaterVolume,
  pondHasCalculableVolume,
  pondVolumeSetupHint,
  pondVolumeSummaryLine,
} from '@/lib/aquaculturePondVolume'
import {
  APPLICATION_METHODS,
  DOSE_UNITS,
  TREATMENT_PURPOSES,
  buildTreatmentMemoForLine,
  isoToday,
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
  MedicineProductLinesEditor,
  MedicineStatCard,
  MedicineTipsAside,
  MedicineTreatmentDeleteDialog,
  type MedicineHistoryRow,
} from './MedicineUi'
import { MedicineTreatmentEditModal } from './MedicineTreatmentEditModal'

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

const inputCls =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20'
const labelCls = 'block text-xs font-medium text-slate-700'

function AquacultureMedicinePageInner() {
  const toast = useToast()
  const searchParams = useSearchParams()
  const initialPond = searchParams.get('pond_id') ?? ''

  const [ponds, setPonds] = useState<Pond[]>([])
  const [pondId, setPondId] = useState(initialPond)
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
  const [showEntryForm, setShowEntryForm] = useState(true)
  const [editRow, setEditRow] = useState<MedicineHistoryRow | null>(null)
  const [deleteRow, setDeleteRow] = useState<MedicineHistoryRow | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [busyRowId, setBusyRowId] = useState<number | null>(null)
  const waterVolumeEditedRef = useRef(false)
  const historySectionRef = useRef<HTMLElement>(null)

  const pondIdNum = pondId.trim() !== '' ? Number.parseInt(pondId, 10) : NaN
  const selectedPond = ponds.find((p) => p.id === pondIdNum) ?? null

  const medicineCatalog = useMemo(() => {
    const meds = inventoryItems.filter(isMedicineItem)
    return meds.length > 0 ? meds : inventoryItems
  }, [inventoryItems])

  const loadPonds = useCallback(async () => {
    try {
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
      const params: Record<string, string> = { kind: 'medicine', limit: '200' }
      if (Number.isFinite(pondIdNum)) params.pond_id = String(pondIdNum)
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
  }, [toast, pondIdNum, historyFrom, historyTo])

  const loadWarehouse = useCallback(async () => {
    if (!Number.isFinite(pondIdNum)) {
      setWarehouseRows([])
      return
    }
    setWhLoading(true)
    try {
      const { data } = await api.get<{ items?: WarehouseStockRow[] }>(
        `/aquaculture/ponds/${pondIdNum}/warehouse-stock/`,
      )
      setWarehouseRows(Array.isArray(data?.items) ? data.items : [])
    } catch {
      setWarehouseRows([])
    } finally {
      setWhLoading(false)
    }
  }, [pondIdNum])

  useEffect(() => {
    void loadPonds()
  }, [loadPonds])

  useEffect(() => {
    if (initialPond && !pondId) setPondId(initialPond)
  }, [initialPond, pondId])

  useEffect(() => {
    void loadLedger()
  }, [loadLedger])

  useEffect(() => {
    if (!Number.isFinite(pondIdNum)) {
      setCycles([])
      setDefaultMedSel('')
      setProductLines([newMedicineProductLine()])
      return
    }
    void (async () => {
      try {
        const { data } = await api.get<CycleRow[]>('/aquaculture/production-cycles/', {
          params: { pond_id: pondIdNum },
        })
        setCycles(Array.isArray(data) ? data : [])
      } catch {
        setCycles([])
      }
    })()
    const p = ponds.find((x) => x.id === pondIdNum)
    if (p?.default_medicine_item_id != null) {
      const id = String(p.default_medicine_item_id)
      setDefaultMedSel(id)
      setProductLines([newMedicineProductLine(id)])
    } else {
      setDefaultMedSel('')
      setProductLines([newMedicineProductLine()])
    }
    void loadWarehouse()
  }, [pondIdNum, ponds, loadWarehouse])

  useEffect(() => {
    waterVolumeEditedRef.current = false
    setShowEntryForm(true)
    setEditRow(null)
    setDeleteRow(null)
  }, [pondIdNum])

  const scrollToHistory = useCallback(() => {
    window.setTimeout(() => {
      historySectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 80)
  }, [])

  useEffect(() => {
    if (!selectedPond || waterVolumeEditedRef.current) return
    const filled = formatTreatmentWaterVolume(selectedPond)
    setTreatment((prev) => ({
      ...prev,
      waterVolume: filled ?? '',
    }))
  }, [selectedPond])

  const pondVolumeLine = selectedPond ? pondVolumeSummaryLine(selectedPond) : null
  const pondVolumeHint = selectedPond ? pondVolumeSetupHint(selectedPond) : ''

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

  const saveDefaultMedicine = async () => {
    if (!Number.isFinite(pondIdNum)) {
      toast.error('Select a pond first')
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
      await api.put(`/aquaculture/ponds/${pondIdNum}/`, body)
      toast.success('Default medicine saved for this pond')
      void loadPonds()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not save'))
    } finally {
      setDefaultMedSaving(false)
    }
  }

  const updateProductLine = (id: string, patch: Partial<MedicineProductLine>) => {
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
      if (empty) return prev.map((l) => (l.id === empty.id ? { ...l, itemId: idStr } : l))
      return prev.map((l, i) => (i === 0 ? { ...l, itemId: idStr } : l))
    })
  }

  const recordMedicine = async () => {
    if (!Number.isFinite(pondIdNum)) {
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
          pond_id: pondIdNum,
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
      const p = ponds.find((x) => x.id === pondIdNum)
      const defaultId = p?.default_medicine_item_id != null ? String(p.default_medicine_item_id) : ''
      setProductLines([newMedicineProductLine(defaultId)])
      if (total === 1) {
        toast.success('Treatment recorded — stock reduced and COGS posted')
      } else {
        toast.success(
          `Recorded ${total} products in one protocol${batchRef ? ` (${batchRef})` : ''} — ${total} COGS lines posted`,
        )
      }
      setShowEntryForm(false)
      setTreatment({ ...EMPTY_TREATMENT })
      waterVolumeEditedRef.current = false
      void loadLedger()
      void loadWarehouse()
      scrollToHistory()
    } catch (e) {
      if (recorded > 0) {
        toast.error(
          `${extractErrorMessage(e, 'Could not finish batch')}. ${recorded} of ${total} product(s) were already saved — review history and retry remaining lines if needed.`,
        )
        void loadLedger()
        void loadWarehouse()
      } else {
        toast.error(extractErrorMessage(e, 'Could not record treatment'))
      }
    } finally {
      setMedSaving(false)
    }
  }

  const setTreatmentField = <K extends keyof TreatmentFormFields>(key: K, value: TreatmentFormFields[K]) => {
    if (key === 'waterVolume') waterVolumeEditedRef.current = true
    setTreatment((prev) => ({ ...prev, [key]: value }))
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
      void loadWarehouse()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not delete treatment'))
    } finally {
      setActionBusy(false)
      setBusyRowId(null)
    }
  }

  const openNewTreatmentForm = () => {
    setShowEntryForm(true)
    setTreatment({ ...EMPTY_TREATMENT })
    waterVolumeEditedRef.current = false
    if (selectedPond) {
      const filled = formatTreatmentWaterVolume(selectedPond)
      if (filled) setTreatment((prev) => ({ ...prev, waterVolume: filled }))
    }
    window.setTimeout(() => {
      document.getElementById('medicine-entry-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 50)
  }

  const refillWaterVolumeFromPond = () => {
    if (!selectedPond) return
    const filled = formatTreatmentWaterVolume(selectedPond)
    if (filled) {
      waterVolumeEditedRef.current = false
      setTreatment((prev) => ({ ...prev, waterVolume: filled }))
      toast.success('Filled from pond dimensions')
    } else {
      toast.error('Set water area and depth on the pond page first')
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <Link
        href="/aquaculture"
        className="inline-flex items-center gap-1 text-sm font-medium text-teal-800 hover:text-teal-950"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Aquaculture
      </Link>

      <header className="mt-4 border-b border-slate-200 pb-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-violet-700">Aquaculture · Health</p>
        <h1 className="mt-1 flex flex-wrap items-center gap-3 text-2xl font-bold tracking-tight text-slate-900">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-md shadow-violet-600/25">
            <Pill className="h-5 w-5" strokeWidth={1.75} aria-hidden />
          </span>
          Medicine & treatments
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-600">
          Log one or more medicines for the same treatment (bath, protocol, or day) in a single submit. Shared dose and
          withdrawal details apply to all products; each product still posts its own stock and COGS line — same flow as{' '}
          <Link href="/aquaculture/feeding" className="font-medium text-teal-800 underline">
            feed consumed
          </Link>
          .
        </p>
      </header>

      {loading ? (
        <div className="mt-12 flex justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-violet-600" />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <label className={labelCls}>
              Pond
              <select className={`${inputCls} max-w-md`} value={pondId} onChange={(e) => setPondId(e.target.value)}>
                <option value="">Select pond…</option>
                {ponds.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {selectedPond ? (
              <p className="mt-2 text-xs text-slate-500">
                <Link
                  href={`/aquaculture/ponds/${selectedPond.id}`}
                  className="inline-flex items-center gap-1 font-medium text-teal-800 hover:underline"
                >
                  <MapPin className="h-3 w-3" aria-hidden />
                  Pond warehouse & setup
                </Link>
                {selectedPond.default_medicine_item_name ? (
                  <span className="ml-2 text-violet-800">
                    · Default SKU: {selectedPond.default_medicine_item_name}
                  </span>
                ) : null}
                {pondVolumeLine ? (
                  <span className="mt-1 block text-violet-900/90">
                    Pond water volume: {pondVolumeLine}
                  </span>
                ) : selectedPond ? (
                  <span className="mt-1 block text-amber-900">{pondVolumeHint}</span>
                ) : null}
              </p>
            ) : null}
          </section>

          {Number.isFinite(pondIdNum) ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <MedicineStatCard
                title="This month"
                value={monthStats.count}
                sub="treatments recorded"
                icon={ClipboardList}
              />
              <MedicineStatCard
                title="Month COGS"
                value={`${sym}${formatNumber(monthStats.total, 0)}`}
                sub="medicine consumed"
                icon={Stethoscope}
                tone="slate"
              />
              <MedicineStatCard
                title="On hand"
                value={medicineOnHand.length}
                sub={medicineOnHand.length === 1 ? 'SKU at pond' : 'SKUs at pond'}
                icon={Package}
                tone={medicineOnHand.length === 0 ? 'amber' : 'violet'}
              />
            </div>
          ) : null}

          {!Number.isFinite(pondIdNum) ? (
            <p className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-14 text-center text-sm text-slate-600">
              Select a pond to record a treatment or review history.
            </p>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[1fr_minmax(240px,280px)]">
              <div className="space-y-6">
                <section
                  ref={historySectionRef}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-violet-500/5 sm:p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">Treatment history</h2>
                      <p className="mt-0.5 text-xs text-slate-600">
                        Recorded medicine use — edit protocol details or delete to restore pond stock and reverse COGS.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-1 text-xs text-slate-600">
                        <Calendar className="h-3.5 w-3.5" aria-hidden />
                        <input
                          type="date"
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                          value={historyFrom}
                          onChange={(e) => setHistoryFrom(e.target.value)}
                        />
                        <span>–</span>
                        <input
                          type="date"
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                          value={historyTo}
                          onChange={(e) => setHistoryTo(e.target.value)}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => void loadLedger()}
                        disabled={ledgerLoading}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${ledgerLoading ? 'animate-spin' : ''}`} aria-hidden />
                        Refresh
                      </button>
                      {!showEntryForm ? (
                        <button
                          type="button"
                          onClick={openNewTreatmentForm}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-violet-800"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden />
                          Record new treatment
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <MedicineHistoryTable
                    rows={ledger}
                    currency={currency}
                    loading={ledgerLoading}
                    formHidden={!showEntryForm}
                    busyRowId={busyRowId}
                    onEdit={(row) => setEditRow(row)}
                    onDelete={(row) => setDeleteRow(row)}
                  />
                </section>

                {!showEntryForm ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/80 px-4 py-3">
                    <p className="text-sm text-emerald-950">
                      Treatment saved. Review history above — stock reduced and COGS posted.
                    </p>
                    <button
                      type="button"
                      onClick={openNewTreatmentForm}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-violet-700 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-800"
                    >
                      <Plus className="h-4 w-4" aria-hidden />
                      Record another
                    </button>
                  </div>
                ) : null}

                {showEntryForm ? (
                <section
                  id="medicine-entry-form"
                  className="overflow-hidden rounded-2xl border border-violet-200/80 bg-white shadow-sm ring-1 ring-violet-500/10"
                >
                  <div className="border-b border-violet-100 bg-gradient-to-r from-violet-50 to-white px-4 py-3 sm:px-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                    <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                      <Stethoscope className="h-4 w-4 text-violet-700" aria-hidden />
                      New treatment entry
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-600">
                      Add multiple products for one protocol, then record once. Quantity uses each product&apos;s stock
                      unit (kg for lime, L or bottle for liquids, bag, etc.). Multi-product treatments share a batch
                      reference in history.
                    </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowEntryForm(false)}
                        className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        Hide form
                      </button>
                    </div>
                  </div>

                  <div className="space-y-5 p-4 sm:p-5">
                    <label className={labelCls}>
                      Treatment date <span className="text-red-600">*</span>
                      <input
                        type="date"
                        className={`${inputCls} max-w-xs`}
                        value={medDate}
                        onChange={(e) => setMedDate(e.target.value)}
                      />
                    </label>

                    <MedicineProductLinesEditor
                      lines={productLines}
                      medicineCatalog={medicineCatalog}
                      stockByItemId={stockByItemId}
                      whLoading={whLoading}
                      inputCls={inputCls}
                      labelCls={labelCls}
                      onChangeLine={updateProductLine}
                      onAddLine={addProductLine}
                      onRemoveLine={removeProductLine}
                    />

                    <fieldset className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 sm:p-4">
                      <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                        Application details (shared by all products)
                      </legend>
                      <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        <label className={labelCls}>
                          Purpose
                          <select
                            className={inputCls}
                            value={treatment.purpose}
                            onChange={(e) => setTreatmentField('purpose', e.target.value as TreatmentFormFields['purpose'])}
                          >
                            <option value="">—</option>
                            {TREATMENT_PURPOSES.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className={labelCls}>
                          Application method
                          <select
                            className={inputCls}
                            value={treatment.method}
                            onChange={(e) => setTreatmentField('method', e.target.value as TreatmentFormFields['method'])}
                          >
                            <option value="">—</option>
                            {APPLICATION_METHODS.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className={labelCls}>
                          Dose rate
                          <div className="mt-1 flex gap-2">
                            <input
                              type="text"
                              inputMode="decimal"
                              className={`${inputCls} mt-0 flex-1 tabular-nums`}
                              value={treatment.doseAmount}
                              onChange={(e) => setTreatmentField('doseAmount', e.target.value)}
                              placeholder="e.g. 2"
                            />
                            <select
                              className={`${inputCls} mt-0 w-36 shrink-0`}
                              value={treatment.doseUnit}
                              onChange={(e) =>
                                setTreatmentField('doseUnit', e.target.value as TreatmentFormFields['doseUnit'])
                              }
                            >
                              <option value="">unit</option>
                              {DOSE_UNITS.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </label>
                        <label className={labelCls}>
                          Water / pond volume treated
                          <div className="mt-1 flex flex-wrap gap-2">
                            <input
                              type="text"
                              className={`${inputCls} mt-0 min-w-[12rem] flex-1`}
                              value={treatment.waterVolume}
                              onChange={(e) => setTreatmentField('waterVolume', e.target.value)}
                              placeholder={
                                selectedPond && pondHasCalculableVolume(selectedPond)
                                  ? 'Auto-filled from pond — edit if partial treatment'
                                  : 'e.g. 500 m³ or full pond'
                              }
                            />
                            {selectedPond ? (
                              <button
                                type="button"
                                onClick={refillWaterVolumeFromPond}
                                disabled={!pondHasCalculableVolume(selectedPond)}
                                className="shrink-0 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-medium text-violet-900 hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-50"
                                title={
                                  pondHasCalculableVolume(selectedPond)
                                    ? 'Recalculate from pond water area and depth'
                                    : pondVolumeHint
                                }
                              >
                                Use pond volume
                              </button>
                            ) : null}
                          </div>
                          {selectedPond ? (
                            <p className="mt-1 text-[11px] leading-relaxed text-slate-600">
                              {pondHasCalculableVolume(selectedPond) ? (
                                <>
                                  Filled from pond setup ({pondVolumeLine}). Change if you only treat part of the
                                  pond.
                                </>
                              ) : (
                                <>
                                  {pondVolumeHint}{' '}
                                  <Link
                                    href={`/aquaculture/ponds/${selectedPond.id}`}
                                    className="font-medium text-teal-800 underline"
                                  >
                                    Open pond setup
                                  </Link>
                                </>
                              )}
                            </p>
                          ) : null}
                        </label>
                        <label className={labelCls}>
                          Withdrawal period (days)
                          <input
                            type="text"
                            inputMode="numeric"
                            className={inputCls}
                            value={treatment.withdrawalDays}
                            onChange={(e) => setTreatmentField('withdrawalDays', e.target.value)}
                            placeholder="e.g. 7"
                          />
                        </label>
                        <label className={labelCls}>
                          Applied by
                          <input
                            type="text"
                            className={inputCls}
                            value={treatment.appliedBy}
                            onChange={(e) => setTreatmentField('appliedBy', e.target.value)}
                            placeholder="Staff name"
                          />
                        </label>
                        <label className={`${labelCls} sm:col-span-2`}>
                          Production cycle
                          <select
                            className={inputCls}
                            value={medCycleId}
                            onChange={(e) => setMedCycleId(e.target.value)}
                          >
                            <option value="">— optional —</option>
                            {cycles.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className={`${labelCls} sm:col-span-2`}>
                          Notes
                          <textarea
                            className={`${inputCls} min-h-[4rem] resize-y`}
                            value={treatment.notes}
                            onChange={(e) => setTreatmentField('notes', e.target.value)}
                            placeholder="Symptoms, fish batch, follow-up schedule…"
                            rows={2}
                          />
                        </label>
                      </div>
                    </fieldset>

                    <button
                      type="button"
                      disabled={medSaving}
                      onClick={() => void recordMedicine()}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 py-3 text-sm font-semibold text-white shadow-md shadow-violet-700/20 hover:bg-violet-800 disabled:opacity-50 sm:w-auto"
                    >
                      <Pill className="h-4 w-4" aria-hidden />
                      {medSaving
                        ? 'Saving…'
                        : filledLineCount > 1
                          ? `Record treatment (${filledLineCount} products)`
                          : 'Record treatment'}
                    </button>
                  </div>
                </section>
                ) : null}

                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                  <button
                    type="button"
                    onClick={() => setShowDefaultSku((v) => !v)}
                    className="flex w-full items-center justify-between gap-2 text-left text-sm font-medium text-slate-800"
                  >
                    <span className="flex items-center gap-2">
                      <Package className="h-4 w-4 text-slate-500" aria-hidden />
                      Default medicine SKU (optional shortcut)
                    </span>
                    {showDefaultSku ? (
                      <ChevronUp className="h-4 w-4 text-slate-400" aria-hidden />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden />
                    )}
                  </button>
                  {showDefaultSku ? (
                    <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-3">
                      <label className={`${labelCls} min-w-[200px] flex-1`}>
                        Product
                        <select
                          className={inputCls}
                          value={defaultMedSel}
                          onChange={(e) => setDefaultMedSel(e.target.value)}
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
                        disabled={defaultMedSaving}
                        onClick={() => void saveDefaultMedicine()}
                        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {defaultMedSaving ? 'Saving…' : 'Save default'}
                      </button>
                    </div>
                  ) : null}
                </section>

              </div>

              <aside className="space-y-4">
                <MedicineTipsAside />
                <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stock at pond</h3>
                  {whLoading ? (
                    <p className="mt-3 text-xs text-slate-500">Loading…</p>
                  ) : medicineOnHand.length === 0 ? (
                    <p className="mt-3 text-xs leading-relaxed text-amber-900">
                      No medicine on hand. Use Inventory → move stock to this pond warehouse before recording
                      treatments.
                    </p>
                  ) : (
                    <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto text-xs">
                      {medicineOnHand.map((r) => {
                        const inForm = productLines.some((l) => l.itemId === String(r.item_id))
                        return (
                          <li key={r.item_id}>
                            <button
                              type="button"
                              onClick={() => assignProductFromStock(r.item_id)}
                              className={`w-full rounded-lg border px-2.5 py-2 text-left transition hover:border-violet-300 hover:bg-violet-50/50 ${
                                inForm
                                  ? 'border-violet-400 bg-violet-50 ring-1 ring-violet-300/50'
                                  : 'border-slate-100 bg-slate-50/80'
                              }`}
                            >
                              <span className="font-medium text-slate-900">{r.item_name}</span>
                              <span className="mt-0.5 block tabular-nums text-slate-600">
                                {r.quantity} {formatStockUnit(r.unit)}
                              </span>
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                  <p className="mt-3 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                    Click a row to add it to the next empty product line.
                  </p>
                </section>
              </aside>
            </div>
          )}
        </div>
      )}

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
    </div>
  )
}

export default function AquacultureMedicinePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-violet-600" />
        </div>
      }
    >
      <AquacultureMedicinePageInner />
    </Suspense>
  )
}
