'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  BarChart3,
  Beaker,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Fish,
  ListOrdered,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Undo2,
  ArrowRightLeft,
} from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { formatDateOnly } from '@/utils/date'
import { aquacultureExpenseDeleteConfirmMessage } from '@/lib/aquacultureExpensePolicy'
import { PondWarehouseAddStockModal } from '@/components/aquaculture/PondWarehouseAddStockModal'
import { PondWarehouseInterPondModal } from '@/components/aquaculture/PondWarehouseInterPondModal'
import { AquacultureWarehouseGroupsPanel } from '@/components/aquaculture/AquacultureWarehouseGroupsPanel'
import { AquacultureStockLedgerFormModal } from './AquacultureStockLedgerFormModal'

const iconAction =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent text-slate-600 transition-colors hover:border-slate-200 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 disabled:pointer-events-none disabled:opacity-40'
const iconActionDanger =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent text-slate-600 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/30 disabled:pointer-events-none disabled:opacity-40'

interface Pond {
  id: number
  name: string
}
interface RefOpt {
  id: string
  label: string
}
interface ReferencePayload {
  entry_kind: RefOpt[]
  loss_reason: RefOpt[]
  coa_note?: string
}
interface CycleRow {
  id: number
  name: string
}
interface PositionRow {
  pond_id: number
  pond_name: string
  pond_role?: string
  water_area_decimal?: string | null
  pond_depth_ft?: string | null
  water_volume_cu_ft?: string | null
  transfer_in_weight_kg: string
  transfer_out_weight_kg: string
  vendor_bill_in_weight_kg?: string
  vendor_bill_in_fish_count?: number
  sale_weight_kg: string
  sale_fish_count: number
  ledger_weight_kg_delta: string
  ledger_fish_count_delta: number
  stocked_weight_kg?: string
  stocked_fish_count?: number
  mortality_weight_kg?: string
  mortality_fish_count?: number
  adjustment_weight_kg?: string
  adjustment_fish_count?: number
  other_adjustment_weight_kg?: string
  other_adjustment_fish_count?: number
  implied_net_weight_kg: string
  implied_net_fish_count: number
  latest_sample_date: string | null
  latest_sample_estimated_fish_count: number | null
  latest_sample_estimated_total_weight_kg: string | null
  latest_sample_fish_species_label?: string | null
  production_cycle_id?: number | null
  production_cycle_name?: string | null
  fish_species?: string
  fish_species_label?: string
  stock_density_kg_per_decimal?: string | null
  stock_density_kg_per_1000_cu_ft?: string | null
  load_level?: string
  load_level_label?: string
  advice_summary?: string
  reference_note?: string
}
interface LedgerRow {
  id: number
  pond_id: number
  pond_name: string
  production_cycle_id?: number | null
  production_cycle_name?: string
  entry_date: string
  entry_kind: string
  entry_kind_label: string
  loss_reason: string
  loss_reason_label?: string | null
  fish_species?: string
  fish_species_other?: string
  fish_species_label?: string
  fish_count_delta: number
  weight_kg_delta: string
  book_value: string
  post_to_books: boolean
  memo: string
  journal_entry_id?: number | null
  journal_is_posted?: boolean
  journal_entry_number?: string
}

/** GET /aquaculture/fish-stock-ledger/?aggregates=1 */
interface FishStockLedgerListPayload {
  rows: LedgerRow[]
  total_row_count: number
  total_fish_count_delta: number
  total_weight_kg_delta: string
  limit: number
  returned: number
}

function isFishStockLedgerPayload(x: unknown): x is FishStockLedgerListPayload {
  return (
    typeof x === 'object' &&
    x !== null &&
    'rows' in x &&
    Array.isArray((x as FishStockLedgerListPayload).rows) &&
    typeof (x as FishStockLedgerListPayload).total_row_count === 'number'
  )
}

interface WarehouseMatrixRow {
  pond_id: number
  pond_name: string
  warehouse_group_id?: number | null
  warehouse_group_name?: string
  is_shared_warehouse_member?: boolean
  item_id: number
  item_name: string
  unit: string
  quantity: string
  pos_category: string
  reporting_category: string
  content_weight_kg: string | null
  unit_cost: string
}

interface MovementRow {
  entry_date: string
  source: string
  source_label: string
  source_id: number
  source_doc: string
  pond_id: number
  pond_name: string
  production_cycle_id?: number | null
  fish_species?: string
  fish_species_label?: string
  loss_reason?: string
  loss_reason_label?: string | null
  fish_count_delta: number
  weight_kg_delta: string
  value_amount: string
  memo: string
  journal_entry_number?: string
}

interface MovementsResponse {
  rows: MovementRow[]
  row_count: number
  limit: number
  sources: RefOpt[]
}

interface ConsumptionRow {
  id: number
  entry_date: string
  kind: 'feed' | 'medicine'
  kind_label: string
  pond_id: number
  pond_name: string
  production_cycle_id?: number | null
  production_cycle_name?: string
  amount: string
  feed_weight_kg?: string | null
  feed_sack_count?: string | null
  memo: string
  source: string
  source_id: number
  source_doc: string
  feeding_advice_id?: number | null
  feeding_advice_target_date?: string | null
  journal_entry_number?: string
  journal_is_posted?: boolean
}

interface ConsumptionResponse {
  rows: ConsumptionRow[]
  row_count: number
  limit: number
  kinds: RefOpt[]
}

const WH_POS_GROUP_LABEL: Record<string, string> = {
  feed: 'Feed',
  fish: 'Fish & fingerlings',
  medicine: 'Medicine & treatment',
  general: 'General & supplies',
  fuel: 'Fuel',
  non_pos: 'Non-POS / hatchery',
}

function warehouseShelfLabel(pos: string | undefined): string {
  const k = (pos || 'general').toLowerCase()
  return WH_POS_GROUP_LABEL[k] || k.replace(/_/g, ' ')
}

type DetailLedgerRow = MovementRow & {
  running_fish_count: number
  running_weight_kg: number
}

function breakdownRowKey(r: PositionRow): string {
  return `${r.pond_id}:${r.production_cycle_id ?? 'none'}:${r.fish_species ?? ''}`
}

function movementMatchesBreakdown(m: MovementRow, r: PositionRow): boolean {
  const cycleMatch =
    r.production_cycle_id == null
      ? m.production_cycle_id == null
      : m.production_cycle_id === r.production_cycle_id
  if (!cycleMatch) return false
  const sp = (r.fish_species || '').trim().toLowerCase()
  if (!sp) return true
  const msp = (m.fish_species || '').trim().toLowerCase()
  if (msp === sp) return true
  if (!msp && m.source === 'vendor_bill') {
    const label = (m.fish_species_label || '').toLowerCase()
    return label.includes(sp) || (sp === 'tilapia' && !label.includes('pangas') && !label.includes('basa'))
  }
  return false
}

function withRunningBalance(rows: MovementRow[]): DetailLedgerRow[] {
  const asc = [...rows].sort((a, b) => {
    const d = a.entry_date.localeCompare(b.entry_date)
    if (d !== 0) return d
    return a.source_id - b.source_id
  })
  let heads = 0
  let kg = 0
  const withBal: DetailLedgerRow[] = asc.map((r) => {
    heads += r.fish_count_delta
    kg += Number(r.weight_kg_delta)
    return { ...r, running_fish_count: heads, running_weight_kg: kg }
  })
  return withBal.reverse()
}

/** A stacked "weight kg / fish count" movement cell with an em-dash fallback for empty values. */
function MovementCell({
  kg,
  fish,
  signed = false,
  tone = 'slate',
}: {
  kg: number
  fish: number
  signed?: boolean
  tone?: 'slate' | 'emerald' | 'rose'
}) {
  const empty = (signed ? kg === 0 && fish === 0 : kg <= 0 && fish <= 0)
  if (empty) return <span className="text-slate-300">—</span>
  const sign = signed && kg > 0 ? '+' : signed && kg < 0 ? '−' : ''
  const fishSign = signed && fish > 0 ? '+' : signed && fish < 0 ? '−' : ''
  const tones: Record<string, [string, string]> = {
    slate: ['text-slate-700', 'text-slate-500'],
    emerald: ['text-emerald-700', 'text-emerald-500'],
    rose: ['text-rose-700', 'text-rose-500'],
  }
  const [main, sub] = tones[tone] || tones.slate
  return (
    <>
      <div className={main}>
        {sign}
        {formatNumber(Math.abs(kg), 2)} kg
      </div>
      <div className={`text-xs font-normal ${sub}`}>
        {fishSign}
        {formatNumber(Math.abs(fish), 0)} fish
      </div>
    </>
  )
}

function StockPositionMetricCells({ r }: { r: PositionRow }) {
  const netC = r.implied_net_fish_count
  const samp = r.latest_sample_estimated_fish_count
  const diff = samp != null && netC != null ? samp - netC : null
  const densityLine =
    r.stock_density_kg_per_decimal != null && r.stock_density_kg_per_decimal !== ''
      ? `${formatNumber(Number(r.stock_density_kg_per_decimal), 2)} kg/dec`
      : null
  const volDensity =
    r.stock_density_kg_per_1000_cu_ft != null && r.stock_density_kg_per_1000_cu_ft !== ''
      ? `${formatNumber(Number(r.stock_density_kg_per_1000_cu_ft), 2)} kg/1k cu ft`
      : null
  const loadBadges: Record<string, string> = {
    understocked: 'bg-sky-50 text-sky-900',
    moderate: 'bg-emerald-50 text-emerald-900',
    full: 'bg-amber-50 text-amber-900',
    high_risk: 'bg-rose-50 text-rose-900',
    unknown: 'bg-slate-50 text-slate-700',
  }
  const ll = r.load_level || 'unknown'
  const badgeClass = loadBadges[ll] || loadBadges.unknown

  const stockedKg = Number(r.stocked_weight_kg ?? r.vendor_bill_in_weight_kg) || 0
  const stockedFish = r.stocked_fish_count ?? r.vendor_bill_in_fish_count ?? 0
  const soldKg = Number(r.sale_weight_kg) || 0
  const soldFish = r.sale_fish_count || 0
  const mortalityKg = Math.abs(Number(r.mortality_weight_kg) || 0)
  const mortalityFish = Math.abs(r.mortality_fish_count || 0)
  const otherKg = Number(r.other_adjustment_weight_kg ?? r.adjustment_weight_kg ?? r.ledger_weight_kg_delta) || 0
  const otherFish = r.other_adjustment_fish_count ?? r.adjustment_fish_count ?? r.ledger_fish_count_delta ?? 0

  return (
    <>
      <td className="py-2 pr-4 tabular-nums">
        <MovementCell kg={stockedKg} fish={stockedFish} tone="emerald" />
      </td>
      <td className="py-2 pr-4 tabular-nums">
        <MovementCell kg={soldKg} fish={soldFish} tone="slate" />
      </td>
      <td className="py-2 pr-4 tabular-nums">
        <MovementCell kg={mortalityKg} fish={mortalityFish} tone="rose" />
      </td>
      <td className="py-2 pr-4 tabular-nums">
        <MovementCell kg={otherKg} fish={otherFish} signed tone="slate" />
      </td>
      <td className="border-l border-slate-200 bg-teal-50/40 py-2 pl-3 pr-4 tabular-nums">
        <div className="font-semibold text-teal-900">{formatNumber(Number(r.implied_net_weight_kg), 2)} kg</div>
        <div className="text-xs font-medium text-teal-700/80">
          {formatNumber(r.implied_net_fish_count, 0)} fish (est.)
        </div>
      </td>
      <td className="py-2 pr-4 text-slate-700">
        <div className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2">
            {r.load_level_label ? (
              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badgeClass}`}>
                {r.load_level_label}
              </span>
            ) : null}
            {densityLine ? (
              <span className="tabular-nums text-sm">{densityLine}</span>
            ) : (
              <span className="text-xs text-slate-500">Set water area and depth on pond</span>
            )}
          </span>
          {volDensity ? <span className="tabular-nums text-xs text-slate-500">{volDensity}</span> : null}
          {r.advice_summary ? (
            <span className="text-xs leading-snug text-slate-600">{r.advice_summary}</span>
          ) : null}
        </div>
      </td>
      <td className="py-2 text-slate-600">
        {r.latest_sample_date ? (
          <div className="flex flex-col gap-1">
            <span className="text-slate-700">{formatDateOnly(r.latest_sample_date)}</span>
            {r.latest_sample_estimated_fish_count != null ? (
              <span className="text-xs text-slate-500">
                ~{formatNumber(r.latest_sample_estimated_fish_count, 0)} fish
                {r.latest_sample_fish_species_label ? ` · ${r.latest_sample_fish_species_label}` : ''}
              </span>
            ) : null}
            {diff != null && diff !== 0 ? (
              <span
                className={`inline-flex w-fit items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${
                  diff > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                }`}
                title="Difference between the latest physical sample estimate and the system's book (calculated) count. Positive means the pond sampled higher than the books expect."
              >
                {diff > 0 ? '+' : '−'}
                {formatNumber(Math.abs(diff), 0)} fish vs book
              </span>
            ) : diff === 0 ? (
              <span className="text-[11px] text-slate-400" title="Sample matches the system book count.">
                Matches book
              </span>
            ) : null}
          </div>
        ) : (
          <span className="text-xs text-slate-400">No sample yet</span>
        )}
      </td>
    </>
  )
}

function AquacultureStockPageContent() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const [ponds, setPonds] = useState<Pond[]>([])
  const [posCycles, setPosCycles] = useState<CycleRow[]>([])
  const [ref, setRef] = useState<ReferencePayload | null>(null)
  const [fishSpecies, setFishSpecies] = useState<RefOpt[]>([])
  const [position, setPosition] = useState<PositionRow[]>([])
  const [positionBreakdown, setPositionBreakdown] = useState<PositionRow[]>([])
  const [expandedBreakdownKey, setExpandedBreakdownKey] = useState<string | null>(null)
  const [breakdownDetail, setBreakdownDetail] = useState<Record<string, DetailLedgerRow[]>>({})
  const [breakdownDetailLoading, setBreakdownDetailLoading] = useState<string | null>(null)
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [ledgerListMeta, setLedgerListMeta] = useState<{
    total_row_count: number
    total_fish_count_delta: number
    total_weight_kg_delta: string
    limit: number
    returned: number
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [positionLoading, setPositionLoading] = useState(false)
  const [currency, setCurrency] = useState('BDT')
  const [posPond, setPosPond] = useState('')
  const [posCycle, setPosCycle] = useState('')
  const [posSpecies, setPosSpecies] = useState('')
  const [modal, setModal] = useState(false)
  const [editingRow, setEditingRow] = useState<LedgerRow | null>(null)
  const [rollbackTarget, setRollbackTarget] = useState<LedgerRow | null>(null)
  const [rollbackBusy, setRollbackBusy] = useState(false)
  const [ledgerQuery, setLedgerQuery] = useState('')
  const [mainTab, setMainTab] = useState<'fish' | 'warehouse'>('fish')
  const [fishSubTab, setFishSubTab] = useState<'manual' | 'movements'>('manual')
  const [whSubTab, setWhSubTab] = useState<'on_hand' | 'consumed'>('on_hand')
  const [whRows, setWhRows] = useState<WarehouseMatrixRow[]>([])
  const [whLoading, setWhLoading] = useState(false)
  const [whPond, setWhPond] = useState('')
  const [whSearch, setWhSearch] = useState('')
  const [whPosCategory, setWhPosCategory] = useState('')
  const [addWhOpen, setAddWhOpen] = useState(false)
  const [interPondOpen, setInterPondOpen] = useState(false)
  const [movements, setMovements] = useState<MovementRow[]>([])
  const [movementsLoading, setMovementsLoading] = useState(false)
  const [movementsSources, setMovementsSources] = useState<RefOpt[]>([])
  /** Server caps combined biomass rows; when returned === limit, older dates may be missing from the list. */
  const [movementsListCap, setMovementsListCap] = useState<{ limit: number; returned: number } | null>(null)
  const [movPond, setMovPond] = useState('')
  const [movSource, setMovSource] = useState('')
  const [movFrom, setMovFrom] = useState('')
  const [movTo, setMovTo] = useState('')
  const [movQuery, setMovQuery] = useState('')
  const [consumption, setConsumption] = useState<ConsumptionRow[]>([])
  const [consumptionLoading, setConsumptionLoading] = useState(false)
  const [consumptionDeleteBusyId, setConsumptionDeleteBusyId] = useState<number | null>(null)
  const [conPond, setConPond] = useState('')
  const [conKind, setConKind] = useState<'' | 'feed' | 'medicine'>('')
  const [conFrom, setConFrom] = useState('')
  const [conTo, setConTo] = useState('')
  const [conQuery, setConQuery] = useState('')

  const replaceFishSpeciesQuery = useCallback(
    (speciesCode: string) => {
      if (typeof window === 'undefined' || !pathname) return
      const sp = new URLSearchParams(window.location.search)
      if (speciesCode) sp.set('fish_species', speciesCode)
      else sp.delete('fish_species')
      const q = sp.toString()
      router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
    },
    [pathname, router],
  )

  const loadPonds = useCallback(async () => {
    try {
      const [co, pRes, rRes, spRes] = await Promise.all([
        api.get<Record<string, unknown>>('/companies/current/'),
        api.get<Pond[]>('/aquaculture/ponds/'),
        api.get<ReferencePayload>('/aquaculture/stock-ledger/reference/'),
        api.get<RefOpt[]>('/aquaculture/fish-species/').catch(() => ({ data: [] })),
      ])
      setCurrency(String(co.data?.currency || 'BDT').slice(0, 3))
      setPonds(Array.isArray(pRes.data) ? pRes.data : [])
      setRef(rRes.data && typeof rRes.data === 'object' ? rRes.data : null)
      setFishSpecies(Array.isArray(spRes.data) ? spRes.data : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load reference data'))
    }
  }, [toast])

  const loadPosition = useCallback(async () => {
    setPositionLoading(true)
    try {
      const params: Record<string, string> = { breakdown: '1' }
      if (posPond) params.pond_id = posPond
      if (posCycle) params.production_cycle_id = posCycle
      if (posSpecies) params.fish_species = posSpecies
      const { data } = await api.get<{ rows: PositionRow[]; breakdown_rows?: PositionRow[] }>(
        '/aquaculture/fish-stock-position/',
        { params },
      )
      setPosition(Array.isArray(data?.rows) ? data.rows : [])
      setPositionBreakdown(Array.isArray(data?.breakdown_rows) ? data.breakdown_rows : [])
      setExpandedBreakdownKey(null)
      setBreakdownDetail({})
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load stock position'))
    } finally {
      setPositionLoading(false)
    }
  }, [toast, posPond, posCycle, posSpecies])

  const loadRows = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string> = {
        aggregates: '1',
        limit: '5000',
      }
      if (posPond) params.pond_id = posPond
      if (posCycle) params.production_cycle_id = posCycle
      if (posSpecies) params.fish_species = posSpecies
      const { data } = await api.get<LedgerRow[] | FishStockLedgerListPayload>('/aquaculture/fish-stock-ledger/', {
        params,
      })
      if (isFishStockLedgerPayload(data)) {
        setRows(Array.isArray(data.rows) ? data.rows : [])
        setLedgerListMeta({
          total_row_count: data.total_row_count,
          total_fish_count_delta: data.total_fish_count_delta,
          total_weight_kg_delta: data.total_weight_kg_delta,
          limit: data.limit,
          returned: data.returned,
        })
      } else {
        setRows(Array.isArray(data) ? data : [])
        setLedgerListMeta(null)
      }
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load ledger'))
      setLedgerListMeta(null)
    } finally {
      setLoading(false)
    }
  }, [toast, posPond, posCycle, posSpecies])

  const loadMovements = useCallback(async () => {
    setMovementsLoading(true)
    try {
      const params: Record<string, string> = {
        // Backend default is 500; request the allowed maximum so recent dates are less likely to be cut off.
        limit: '2000',
      }
      if (movPond) params.pond_id = movPond
      if (movSource) params.sources = movSource
      if (movFrom) params.date_from = movFrom
      if (movTo) params.date_to = movTo
      // Align with Implied stock position: one species vs all species, and optional cycle scope.
      if (posSpecies) params.fish_species = posSpecies
      if (posCycle) params.production_cycle_id = posCycle
      const { data } = await api.get<MovementsResponse>('/aquaculture/fish-biomass-ledger/', { params })
      const list = Array.isArray(data?.rows) ? data.rows : []
      setMovements(list)
      const lim = typeof data?.limit === 'number' ? data.limit : 2000
      setMovementsListCap({ limit: lim, returned: list.length })
      if (Array.isArray(data?.sources)) setMovementsSources(data.sources)
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load fish movements'))
      setMovements([])
      setMovementsListCap(null)
    } finally {
      setMovementsLoading(false)
    }
  }, [toast, movPond, movSource, movFrom, movTo, posSpecies, posCycle])

  const toggleBreakdownDetail = useCallback(
    async (r: PositionRow) => {
      const key = breakdownRowKey(r)
      if (expandedBreakdownKey === key) {
        setExpandedBreakdownKey(null)
        return
      }
      setExpandedBreakdownKey(key)
      if (breakdownDetail[key]?.length) return
      setBreakdownDetailLoading(key)
      try {
        const params: Record<string, string> = { limit: '2000' }
        params.pond_id = String(r.pond_id)
        if (r.production_cycle_id != null) params.production_cycle_id = String(r.production_cycle_id)
        if (r.fish_species) params.fish_species = r.fish_species
        const { data } = await api.get<MovementsResponse>('/aquaculture/fish-biomass-ledger/', { params })
        const list = (Array.isArray(data?.rows) ? data.rows : []).filter((m) => movementMatchesBreakdown(m, r))
        setBreakdownDetail((prev) => ({ ...prev, [key]: withRunningBalance(list) }))
      } catch (e) {
        toast.error(extractErrorMessage(e, 'Could not load detail ledger'))
      } finally {
        setBreakdownDetailLoading(null)
      }
    },
    [expandedBreakdownKey, breakdownDetail, toast],
  )

  const loadConsumption = useCallback(async () => {
    setConsumptionLoading(true)
    try {
      const params: Record<string, string> = {}
      if (conPond) params.pond_id = conPond
      if (conKind) params.kind = conKind
      if (conFrom) params.date_from = conFrom
      if (conTo) params.date_to = conTo
      const { data } = await api.get<ConsumptionResponse>(
        '/aquaculture/pond-warehouse-consumption-ledger/',
        { params },
      )
      setConsumption(Array.isArray(data?.rows) ? data.rows : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load consumption ledger'))
      setConsumption([])
    } finally {
      setConsumptionLoading(false)
    }
  }, [toast, conPond, conKind, conFrom, conTo])

  const deleteConsumptionRow = async (r: ConsumptionRow) => {
    const cat = r.kind === 'feed' ? 'feed_consumed' : 'medicine_consumed'
    if (
      !window.confirm(
        aquacultureExpenseDeleteConfirmMessage({ expense_category: cat, source_station_id: null }),
      )
    ) {
      return
    }
    setConsumptionDeleteBusyId(r.id)
    try {
      await api.delete(`/aquaculture/expenses/${r.id}/`)
      toast.success(r.kind === 'feed' ? 'Feed consumption deleted — stock restored' : 'Medicine consumption deleted')
      void loadConsumption()
      if (mainTab === 'warehouse' && whSubTab === 'on_hand') void loadWarehouseMatrix()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not delete'))
    } finally {
      setConsumptionDeleteBusyId(null)
    }
  }

  const loadWarehouseMatrix = useCallback(async () => {
    setWhLoading(true)
    try {
      const params: Record<string, string> = {}
      if (whPond) params.pond_id = whPond
      const { data } = await api.get<{ rows: WarehouseMatrixRow[] }>('/aquaculture/pond-warehouse-stock-overview/', {
        params,
      })
      setWhRows(Array.isArray(data?.rows) ? data.rows : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load pond warehouse stock'))
      setWhRows([])
    } finally {
      setWhLoading(false)
    }
  }, [toast, whPond])

  const filteredLedgerRows = useMemo(() => {
    const q = ledgerQuery.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      const hay = [
        r.pond_name,
        r.production_cycle_name,
        r.entry_kind_label,
        r.loss_reason_label,
        r.loss_reason,
        r.fish_species_label,
        r.memo,
        r.journal_entry_number,
        formatDateOnly(r.entry_date),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [rows, ledgerQuery])

  const filteredWhRows = useMemo(() => {
    const q = whSearch.trim().toLowerCase()
    const cat = whPosCategory.trim().toLowerCase()
    return whRows.filter((r) => {
      if (cat && (r.pos_category || '').toLowerCase() !== cat) return false
      if (!q) return true
      const hay = [r.pond_name, r.item_name, r.reporting_category, warehouseShelfLabel(r.pos_category)]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [whRows, whSearch, whPosCategory])

  const whPosCategoryOptions = useMemo(() => {
    const s = new Set<string>()
    for (const r of whRows) s.add((r.pos_category || 'general').toLowerCase())
    return [...s].sort()
  }, [whRows])

  const whWarehouseSummary = useMemo(() => {
    const ponds = new Set(whRows.map((r) => r.pond_id))
    return { lineCount: whRows.length, pondCount: ponds.size }
  }, [whRows])

  const filteredWhSummary = useMemo(() => {
    const ponds = new Set(filteredWhRows.map((r) => r.pond_id))
    return { lineCount: filteredWhRows.length, pondCount: ponds.size }
  }, [filteredWhRows])

  const filteredMovements = useMemo(() => {
    const q = movQuery.trim().toLowerCase()
    if (!q) return movements
    return movements.filter((r) => {
      const hay = [
        r.pond_name,
        r.source_label,
        r.source_doc,
        r.fish_species_label,
        r.loss_reason_label,
        r.memo,
        r.journal_entry_number,
        formatDateOnly(r.entry_date),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [movements, movQuery])

  const movementsTotals = useMemo(() => {
    let kg = 0
    let fish = 0
    let value = 0
    for (const r of filteredMovements) {
      kg += Number(r.weight_kg_delta) || 0
      fish += Number(r.fish_count_delta) || 0
      value += Number(r.value_amount) || 0
    }
    return { kg, fish, value }
  }, [filteredMovements])

  const filteredConsumption = useMemo(() => {
    const q = conQuery.trim().toLowerCase()
    if (!q) return consumption
    return consumption.filter((r) => {
      const hay = [
        r.pond_name,
        r.kind_label,
        r.source_doc,
        r.production_cycle_name,
        r.memo,
        r.journal_entry_number,
        formatDateOnly(r.entry_date),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [consumption, conQuery])

  const consumptionTotals = useMemo(() => {
    let amount = 0
    let kg = 0
    let sacks = 0
    for (const r of filteredConsumption) {
      amount += Number(r.amount) || 0
      if (r.feed_weight_kg) kg += Number(r.feed_weight_kg) || 0
      if (r.feed_sack_count) sacks += Number(r.feed_sack_count) || 0
    }
    return { amount, kg, sacks }
  }, [filteredConsumption])

  const positionSummary = useMemo(() => {
    if (position.length === 0) {
      return { pondCount: 0, totalKg: 0, totalFish: 0 }
    }
    let totalKg = 0
    let totalFish = 0
    for (const r of position) {
      totalKg += Number(r.implied_net_weight_kg) || 0
      totalFish += Number(r.implied_net_fish_count) || 0
    }
    return { pondCount: position.length, totalKg, totalFish }
  }, [position])

  /** Sums manual stock-ledger deltas included in implied net (matches backend ledger_by_pond aggregation). */
  const ledgerComponentFromPosition = useMemo(() => {
    let kg = 0
    let fish = 0
    for (const r of position) {
      kg += Number(r.ledger_weight_kg_delta) || 0
      fish += Number(r.ledger_fish_count_delta) || 0
    }
    return { kg, fish }
  }, [position])

  const visibleLedgerTotals = useMemo(() => {
    let kg = 0
    let fish = 0
    for (const r of filteredLedgerRows) {
      kg += Number(r.weight_kg_delta) || 0
      fish += Number(r.fish_count_delta) || 0
    }
    return { kg, fish }
  }, [filteredLedgerRows])

  const ledgerTruncated =
    ledgerListMeta != null && ledgerListMeta.returned < ledgerListMeta.total_row_count
  const ledgerTotalsDrift =
    !positionLoading &&
    !loading &&
    ledgerListMeta != null &&
    (ledgerListMeta.total_fish_count_delta !== ledgerComponentFromPosition.fish ||
      Math.abs(
        Number(ledgerListMeta.total_weight_kg_delta) - ledgerComponentFromPosition.kg,
      ) > 0.0005)

  useEffect(() => {
    void loadPonds()
  }, [loadPonds])

  /** Deep link: `?fish_species=tilapia` (or `species=`) — stays in sync when the query string changes. */
  useEffect(() => {
    const raw = (searchParams.get('fish_species') || searchParams.get('species') || '').trim().toLowerCase()
    if (!raw) {
      setPosSpecies('')
      return
    }
    if (fishSpecies.length > 0 && !fishSpecies.some((o) => o.id === raw)) return
    setPosSpecies(raw)
  }, [searchParams, fishSpecies])

  useEffect(() => {
    void loadPosition()
  }, [loadPosition])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  useEffect(() => {
    if (mainTab !== 'warehouse') return
    if (whSubTab === 'on_hand') void loadWarehouseMatrix()
    else void loadConsumption()
  }, [mainTab, whSubTab, loadWarehouseMatrix, loadConsumption])

  useEffect(() => {
    if (mainTab !== 'fish' || fishSubTab !== 'movements') return
    void loadMovements()
  }, [mainTab, fishSubTab, loadMovements])

  useEffect(() => {
    if (!posPond) {
      setPosCycles([])
      setPosCycle('')
      return
    }
    void (async () => {
      try {
        const { data } = await api.get<CycleRow[]>('/aquaculture/production-cycles/', { params: { pond_id: posPond } })
        setPosCycles(Array.isArray(data) ? data : [])
      } catch {
        setPosCycles([])
      }
    })()
  }, [posPond])

  const sym = getCurrencySymbol(currency)

  const openNew = () => {
    setEditingRow(null)
    setModal(true)
  }

  const openEdit = (r: LedgerRow) => {
    setEditingRow(r)
    setModal(true)
  }

  const closeLedgerModal = () => {
    setModal(false)
    setEditingRow(null)
  }

  const executeRollback = async () => {
    const r = rollbackTarget
    if (!r) return
    setRollbackBusy(true)
    try {
      await api.delete(`/aquaculture/fish-stock-ledger/${r.id}/`)
      toast.success('Entry rolled back — stock position and ledger updated')
      setRollbackTarget(null)
      void loadRows()
      void loadPosition()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Rollback failed'))
    } finally {
      setRollbackBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Link
            href="/aquaculture"
            className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-teal-800 hover:text-teal-950"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Dashboard
          </Link>
          <h1 id="aq-stock-title" className="text-2xl font-bold tracking-tight text-slate-900">
            Pond stock
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600">
            Fish biomass (live weight and head counts in water) is separate from pond warehouse inventory (feed,
            medicine, and supplies). Use the tabs below—each is tracked and updated differently.
          </p>
          <div
            className="mt-4 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 shadow-inner"
            role="tablist"
            aria-label="Stock view"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mainTab === 'fish'}
              id="stock-tab-fish"
              aria-controls="stock-panel-fish"
              onClick={() => setMainTab('fish')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                mainTab === 'fish'
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <Fish className="h-4 w-4 text-current opacity-90" aria-hidden />
                Fish biomass
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mainTab === 'warehouse'}
              id="stock-tab-warehouse"
              aria-controls="stock-panel-warehouse"
              onClick={() => setMainTab('warehouse')}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                mainTab === 'warehouse'
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <Package className="h-4 w-4 text-current opacity-90" aria-hidden />
                Feed &amp; supplies
              </span>
            </button>
          </div>
          {mainTab === 'fish' && ref?.coa_note ? <p className="mt-3 text-xs text-slate-500">{ref.coa_note}</p> : null}
          {mainTab === 'warehouse' ? (
            <p className="mt-3 max-w-3xl text-xs leading-relaxed text-slate-500">
              Feed, medicine, and supplies stored at each pond. Use <strong className="font-medium text-slate-700">Add stock</strong>{' '}
              to move from your shop, or{' '}
              <Link href="/inventory" className="font-medium text-teal-800 underline hover:text-teal-950">
                Inventory
              </Link>{' '}
              for advanced transfers. Consumption happens on{' '}
              <Link href="/aquaculture/feeding" className="font-medium text-teal-800 underline hover:text-teal-950">
                feeding advice
              </Link>{' '}
              and{' '}
              <Link href="/aquaculture/medicine" className="font-medium text-teal-800 underline hover:text-teal-950">
                medicine
              </Link>
              .
            </p>
          ) : null}
          {mainTab === 'fish' ? (
            <p className="mt-3 max-w-3xl text-xs leading-relaxed text-slate-500">
              Mortality, predation, theft, and manual corrections: each ledger entry needs both a fish count delta and a
              weight (kg) delta. Optional GL posting uses your aquaculture COA accounts.
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              void loadRows()
              void loadPosition()
              if (mainTab === 'warehouse') {
                if (whSubTab === 'on_hand') void loadWarehouseMatrix()
                else void loadConsumption()
              }
              if (mainTab === 'fish' && fishSubTab === 'movements') void loadMovements()
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${
                loading || positionLoading || whLoading || movementsLoading || consumptionLoading
                  ? 'animate-spin'
                  : ''
              }`}
              aria-hidden
            />
            Refresh
          </button>
          {mainTab === 'fish' ? (
            <button
              type="button"
              onClick={openNew}
              disabled={ponds.length === 0}
              title={ponds.length === 0 ? 'Add a pond first' : undefined}
              className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" aria-hidden />
              Add ledger entry
            </button>
          ) : null}
        </div>
      </div>

      {mainTab === 'fish' ? (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              <BarChart3 className="h-3.5 w-3.5 text-teal-700" aria-hidden />
              Implied position
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
              {positionLoading ? '—' : formatNumber(positionSummary.totalKg, 2)}{' '}
              <span className="text-base font-normal text-slate-500">kg</span>
            </p>
            <p className="mt-0.5 text-sm text-slate-600">
              {positionLoading
                ? 'Loading…'
                : `${formatNumber(positionSummary.totalFish, 0)} fish est. · ${positionSummary.pondCount} pond${
                    positionSummary.pondCount === 1 ? '' : 's'
                  }`}
            </p>
            <p className="mt-2 border-t border-slate-100 pt-2 text-xs leading-snug text-slate-500">
              Includes transfers, vendor fry lines, sales, and manual ledger — not the manual table alone.
              {posSpecies === 'tilapia' ? (
                <>
                  {' '}
                  Matches the <span className="font-medium text-slate-600">Tilapia stock</span> column on Ponds (vendor
                  fish lines default to tilapia unless the item suggests pangasius/basa).
                </>
              ) : posSpecies ? (
                <> Only this species counts toward transfers, sales, samples, and manual ledger rows.</>
              ) : null}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              <ListOrdered className="h-3.5 w-3.5 text-teal-700" aria-hidden />
              Manual ledger (in implied balance)
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
              {loading || positionLoading
                ? '—'
                : `${formatNumber(ledgerComponentFromPosition.kg, 2)} kg`}
            </p>
            <p className="mt-0.5 text-sm text-slate-600">
              {loading || positionLoading
                ? 'Loading…'
                : `${formatNumber(ledgerComponentFromPosition.fish, 0)} fish Δ · ${
                    ledgerListMeta?.total_row_count ?? rows.length
                  } entr${(ledgerListMeta?.total_row_count ?? rows.length) === 1 ? 'y' : 'ies'} (full history)`}
            </p>
            <p className="mt-2 border-t border-slate-100 pt-2 text-xs leading-snug text-slate-500">
              Same pond / cycle / species scope as the table below. Totals match the “Manual ledger Δ” column in implied
              position.
              {ledgerTruncated ? (
                <span className="mt-1 block font-medium text-amber-800">
                  Only the most recent {ledgerListMeta?.returned} rows are loaded; raise limit or filter by pond if you
                  need the full list.
                </span>
              ) : null}
              {ledgerTotalsDrift ? (
                <span className="mt-1 block font-medium text-rose-800">
                  Ledger totals from the server do not match the implied-position ledger component — refresh or contact
                  support.
                </span>
              ) : null}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              <Fish className="h-3.5 w-3.5 text-teal-700" aria-hidden />
              Operations
            </div>
            <p className="mt-2 text-sm leading-snug text-slate-600">
              <span className="font-medium text-slate-800">Edit</span> updates a row;{' '}
              <span className="font-medium text-slate-800">Rollback</span> deletes it and reverses biological deltas (and
              removes the automatic GL journal when applicable).
            </p>
          </div>
        </div>
      ) : (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              <Package className="h-3.5 w-3.5 text-teal-700" aria-hidden />
              Warehouse lines
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
              {whLoading ? '—' : formatNumber(whWarehouseSummary.lineCount, 0)}
            </p>
            <p className="mt-0.5 text-sm text-slate-600">
              {whLoading
                ? 'Loading…'
                : whSearch.trim() || whPosCategory
                  ? `${formatNumber(filteredWhSummary.lineCount, 0)} shown after filters`
                  : 'SKUs with quantity on hand'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              <BarChart3 className="h-3.5 w-3.5 text-teal-700" aria-hidden />
              Ponds in view
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
              {whLoading ? '—' : formatNumber(filteredWhSummary.pondCount, 0)}
            </p>
            <p className="mt-0.5 text-sm text-slate-600">
              {whPond ? 'Filtered to one pond' : 'Distinct ponds in the table'}
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              <ListOrdered className="h-3.5 w-3.5 text-teal-700" aria-hidden />
              Book value
            </div>
            <p className="mt-2 text-sm leading-snug text-slate-600">
              Extended value uses average unit cost for reference. Actual COGS posts when you consume stock or apply
              feeding advice.
            </p>
          </div>
        </div>
      )}

      {mainTab === 'fish' ? (
        <div id="stock-panel-fish" role="tabpanel" aria-labelledby="stock-tab-fish">
      {ponds.length === 0 ? (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950">
          <p className="font-medium">Add at least one pond before recording stock or mortality.</p>
          <Link href="/aquaculture/ponds" className="mt-2 inline-block font-medium text-teal-800 underline">
            Go to Ponds
          </Link>
        </div>
      ) : null}

      <div
        className="mb-4 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 shadow-inner"
        role="tablist"
        aria-label="Fish ledger view"
      >
        <button
          type="button"
          role="tab"
          aria-selected={fishSubTab === 'manual'}
          onClick={() => setFishSubTab('manual')}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            fishSubTab === 'manual'
              ? 'bg-teal-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Manual entries
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={fishSubTab === 'movements'}
          onClick={() => setFishSubTab('movements')}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            fishSubTab === 'movements'
              ? 'bg-teal-600 text-white shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          Movements (all sources)
        </button>
      </div>

      <section className="mb-8 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Implied stock position</h2>
        <p className="mt-1 text-xs text-slate-500">
          Net fish count and kg from transfers, sales, and manual ledger; <span className="font-medium text-slate-600">Manual ledger Δ</span>{' '}
          is only mortality and adjustments. Latest sample is for comparison. Open a pond for depth, feeding, and detail.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          <span className="font-medium text-slate-600">Cycle:</span> when you pick one production cycle, only movements
          and sales tagged to that cycle count — and manual stock-ledger rows with <em>no</em> cycle are left out, so
          implied net can look low or negative while the pond still has fish. Use &quot;All cycles&quot; for a full pond
          total. <span className="font-medium text-slate-600">Tilapia:</span> vendor fry/fish bill lines count as
          tilapia unless the item name suggests pangasius/basa.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <select
            value={posPond}
            onChange={(e) => setPosPond(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">All ponds</option>
            {ponds.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {p.name}
              </option>
            ))}
          </select>
          <select
            value={posCycle}
            onChange={(e) => setPosCycle(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            disabled={!posPond}
          >
            <option value="">All cycles (pond total)</option>
            {posCycles.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={posSpecies}
            onChange={(e) => {
              const v = e.target.value
              setPosSpecies(v)
              replaceFishSpeciesQuery(v)
            }}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            aria-label="Filter implied position by fish species"
            title="Restrict the implied balance to one species (useful for polyculture ponds)"
          >
            <option value="">All species</option>
            {fishSpecies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <Link
            href="/aquaculture/stock?fish_species=tilapia"
            className="inline-flex items-center self-center rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-900 hover:bg-teal-100"
            title="Opens this page with Tilapia selected — Refresh for latest server data"
          >
            Tilapia stock &amp; ledger
          </Link>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Share or bookmark <span className="font-mono text-[11px] text-slate-600">/aquaculture/stock?fish_species=tilapia</span>{' '}
          for a Tilapia-only view. Use <span className="font-medium text-slate-600">Refresh</span> to pull up-to-date
          position and ledger from the server.
        </p>
        <div className="mt-4 overflow-x-auto">
          {positionLoading ? (
            <p className="py-6 text-center text-sm text-slate-500">Loading positions…</p>
          ) : (
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <th className="py-2 pr-4">Pond</th>
                  <th className="py-2 pr-4">Water vol.</th>
                  <th className="py-2 pr-4">Net fish / kg</th>
                  <th className="py-2 pr-4">Manual ledger Δ</th>
                  <th className="py-2 pr-4">Density / load</th>
                  <th className="py-2 pr-4">Latest sample</th>
                  <th className="py-2">Sample vs net</th>
                </tr>
              </thead>
              <tbody>
                {position.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-slate-500">
                      No implied position for this filter yet. Positions build from transfers, posted vendor fry (pond
                      lines), pond sales, and ledger entries.
                    </td>
                  </tr>
                ) : (
                  position.map((r) => {
                    const netC = r.implied_net_fish_count
                    const samp = r.latest_sample_estimated_fish_count
                    const diff = samp != null && netC != null ? samp - netC : null
                    const vol =
                      r.water_volume_cu_ft != null && r.water_volume_cu_ft !== ''
                        ? `${formatNumber(Number(r.water_volume_cu_ft), 0)} cu ft`
                        : '—'
                    const densityLine =
                      r.stock_density_kg_per_decimal != null && r.stock_density_kg_per_decimal !== ''
                        ? `${formatNumber(Number(r.stock_density_kg_per_decimal), 2)} kg/dec`
                        : null
                    const volDensity =
                      r.stock_density_kg_per_1000_cu_ft != null && r.stock_density_kg_per_1000_cu_ft !== ''
                        ? `${formatNumber(Number(r.stock_density_kg_per_1000_cu_ft), 2)} kg/1k cu ft`
                        : null
                    const loadBadges: Record<string, string> = {
                      understocked: 'bg-sky-50 text-sky-900',
                      moderate: 'bg-emerald-50 text-emerald-900',
                      full: 'bg-amber-50 text-amber-900',
                      high_risk: 'bg-rose-50 text-rose-900',
                      unknown: 'bg-slate-50 text-slate-700',
                    }
                    const ll = r.load_level || 'unknown'
                    const badgeClass = loadBadges[ll] || loadBadges.unknown
                    return (
                      <tr key={r.pond_id} className="border-b border-slate-100 transition-colors hover:bg-slate-50/80">
                        <td className="py-2 pr-4 font-medium text-slate-800">
                          <Link
                            href={`/aquaculture/ponds/${r.pond_id}`}
                            className="inline-flex items-center gap-1 text-teal-800 hover:text-teal-950 hover:underline"
                          >
                            {r.pond_name}
                            <ExternalLink className="h-3 w-3 opacity-60" aria-hidden />
                          </Link>
                        </td>
                        <td className="py-2 pr-4 tabular-nums text-slate-700">{vol}</td>
                        <td className="py-2 pr-4 tabular-nums">
                          <div>{formatNumber(Number(r.implied_net_weight_kg), 2)} kg</div>
                          <div className="text-xs font-normal text-slate-500">
                            {formatNumber(r.implied_net_fish_count, 0)} fish (est.)
                          </div>
                        </td>
                        <td className="py-2 pr-4 tabular-nums text-slate-700">
                          <div>{formatNumber(Number(r.ledger_weight_kg_delta), 2)} kg</div>
                          <div className="text-xs font-normal text-slate-500">
                            {formatNumber(r.ledger_fish_count_delta, 0)} fish Δ
                          </div>
                        </td>
                        <td className="py-2 pr-4 text-slate-700">
                          <div className="flex flex-col gap-1">
                            <span className="flex flex-wrap items-center gap-2">
                              {r.load_level_label ? (
                                <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badgeClass}`}>
                                  {r.load_level_label}
                                </span>
                              ) : null}
                              {densityLine ? (
                                <span className="tabular-nums text-sm">{densityLine}</span>
                              ) : (
                                <span className="text-xs text-slate-500">Set water area and depth on pond</span>
                              )}
                            </span>
                            {volDensity ? (
                              <span className="tabular-nums text-xs text-slate-500">{volDensity}</span>
                            ) : null}
                            {r.advice_summary ? (
                              <span className="text-xs leading-snug text-slate-600">{r.advice_summary}</span>
                            ) : null}
                          </div>
                        </td>
                        <td className="py-2 pr-4 text-slate-600">
                          {r.latest_sample_date ? formatDateOnly(r.latest_sample_date) : '—'}
                          {r.latest_sample_estimated_fish_count != null
                            ? ` · ~${formatNumber(r.latest_sample_estimated_fish_count, 0)} fish`
                            : ''}
                          {r.latest_sample_fish_species_label
                            ? ` · ${r.latest_sample_fish_species_label}`
                            : ''}
                        </td>
                        <td className="py-2 text-slate-600">
                          {diff == null ? '—' : `${diff > 0 ? '+' : ''}${formatNumber(diff, 0)} vs implied net`}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="mb-8 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">By species &amp; production cycle</h2>
        <p className="mt-1 text-xs text-slate-500">
          One row per pond, production cycle, and species. Each row reconciles as{' '}
          <span className="font-medium text-slate-700">
            Stocked − Sold − Mortality + Other adj. = Present stock
          </span>
          . Expand a row for the chronological detail ledger with running balance after each movement.
        </p>
        <div className="mt-4 overflow-x-auto">
          {positionLoading ? (
            <p className="py-6 text-center text-sm text-slate-500">Loading breakdown…</p>
          ) : (
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                  <th className="w-8 py-2 pr-2" aria-label="Expand" />
                  <th className="py-2 pr-3">Pond</th>
                  <th className="py-2 pr-3">Cycle</th>
                  <th className="py-2 pr-3">Species</th>
                  <th
                    className="py-2 pr-4"
                    title="Opening stock-in for this bucket before sale/mortality/other-adjustment events: vendor purchase bills + transfer-ins + positive (opening/stock-in) ledger adjustments."
                  >
                    Stocked
                  </th>
                  <th className="py-2 pr-4" title="Fish sold out of this bucket via pond sales.">
                    Sold
                  </th>
                  <th className="py-2 pr-4" title="Mortality and losses (death, predators, theft, etc.).">
                    Mortality
                  </th>
                  <th
                    className="py-2 pr-4"
                    title="Remaining adjustments after stock-in: transfer-outs and negative manual adjustments. Signed: + adds, − removes."
                  >
                    Other adj.
                  </th>
                  <th
                    className="border-l border-slate-200 py-2 pl-3 pr-4 text-teal-900"
                    title="Current live balance = Stocked − Sold − Mortality + Other adj."
                  >
                    Present stock
                  </th>
                  <th className="py-2 pr-4">Density / load</th>
                  <th className="py-2" title="Latest physical sample and how it compares to the system book count.">
                    Latest sample
                  </th>
                </tr>
              </thead>
              <tbody>
                {positionBreakdown.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-8 text-center text-slate-500">
                      No cycle × species buckets for this filter yet.
                    </td>
                  </tr>
                ) : (
                  positionBreakdown.map((r) => {
                    const key = breakdownRowKey(r)
                    const open = expandedBreakdownKey === key
                    const detail = breakdownDetail[key] ?? []
                    const detailBusy = breakdownDetailLoading === key
                    return (
                      <Fragment key={key}>
                        <tr className="border-b border-slate-100 transition-colors hover:bg-slate-50/80">
                          <td className="py-2 pr-2">
                            <button
                              type="button"
                              onClick={() => void toggleBreakdownDetail(r)}
                              className={iconAction}
                              aria-expanded={open}
                              aria-label={open ? 'Hide detail ledger' : 'Show detail ledger'}
                            >
                              {open ? (
                                <ChevronDown className="h-4 w-4" aria-hidden />
                              ) : (
                                <ChevronRight className="h-4 w-4" aria-hidden />
                              )}
                            </button>
                          </td>
                          <td className="py-2 pr-3 font-medium text-slate-800">
                            <Link
                              href={`/aquaculture/ponds/${r.pond_id}`}
                              className="text-teal-800 hover:text-teal-950 hover:underline"
                            >
                              {r.pond_name}
                            </Link>
                          </td>
                          <td className="py-2 pr-3 text-slate-700">
                            {r.production_cycle_name?.trim() || (
                              <span className="text-slate-400">— No cycle</span>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-slate-700">{r.fish_species_label || r.fish_species || '—'}</td>
                          <StockPositionMetricCells r={r} />
                        </tr>
                        {open ? (
                          <tr key={`${key}-detail`} className="border-b border-slate-100 bg-slate-50/60">
                            <td colSpan={11} className="px-3 py-3">
                              {detailBusy ? (
                                <p className="text-xs text-slate-500">Loading detail ledger…</p>
                              ) : detail.length === 0 ? (
                                <p className="text-xs text-slate-500">No movements in this bucket.</p>
                              ) : (
                                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                  <table className="min-w-full text-left text-xs">
                                    <thead>
                                      <tr className="border-b border-slate-200 text-[10px] uppercase text-slate-500">
                                        <th className="px-2 py-2">Date</th>
                                        <th className="px-2 py-2">Source</th>
                                        <th className="px-2 py-2 text-right">Heads Δ</th>
                                        <th className="px-2 py-2 text-right">Weight Δ (kg)</th>
                                        <th className="px-2 py-2 text-right">Running heads</th>
                                        <th className="px-2 py-2 text-right">Running kg</th>
                                        <th className="px-2 py-2">Memo</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {detail.map((d, i) => (
                                        <tr
                                          key={`${d.source}-${d.source_id}-${d.entry_date}-${i}`}
                                          className="border-b border-slate-50"
                                        >
                                          <td className="px-2 py-1.5 tabular-nums text-slate-700">
                                            {formatDateOnly(d.entry_date)}
                                          </td>
                                          <td className="px-2 py-1.5 text-slate-700">{d.source_label}</td>
                                          <td className="px-2 py-1.5 text-right tabular-nums">
                                            {d.fish_count_delta > 0 ? '+' : ''}
                                            {formatNumber(d.fish_count_delta, 0)}
                                          </td>
                                          <td className="px-2 py-1.5 text-right tabular-nums">
                                            {formatNumber(Number(d.weight_kg_delta), 2)}
                                          </td>
                                          <td className="px-2 py-1.5 text-right tabular-nums font-medium text-slate-800">
                                            {formatNumber(d.running_fish_count, 0)}
                                          </td>
                                          <td className="px-2 py-1.5 text-right tabular-nums font-medium text-slate-800">
                                            {formatNumber(d.running_weight_kg, 2)}
                                          </td>
                                          <td
                                            className="max-w-[14rem] truncate px-2 py-1.5 text-slate-600"
                                            title={d.memo}
                                          >
                                            {d.memo || d.source_doc || '—'}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    )
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {fishSubTab === 'manual' ? (
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Stock ledger (manual entries)</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Mortality, predation, theft, and manual count/weight adjustments. Rollback reverses biological deltas
              and removes the automatic GL journal when applicable. The list uses the same pond, production cycle, and
              species filters as <span className="font-medium text-slate-600">Implied stock position</span> above so
              totals match the ledger component of that balance.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[12rem] flex-1 sm:max-w-xs sm:flex-initial">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <input
                type="search"
                value={ledgerQuery}
                onChange={(e) => setLedgerQuery(e.target.value)}
                placeholder="Search memo, pond, journal…"
                className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                aria-label="Search ledger"
              />
            </div>
            <select
              value={posPond}
              onChange={(e) => setPosPond(e.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              aria-label="Filter ledger by pond (same as implied position)"
            >
              <option value="">All ponds</option>
              {ponds.map((p) => (
                <option key={p.id} value={String(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        {posCycle ? (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs text-amber-950">
            <span className="font-medium">Production cycle filter is on.</span> Only manual ledger lines linked to this
            cycle are listed. Rows with no cycle or on another cycle are omitted, so the latest date here can be older
            than your most recent pond activity. Pick <span className="font-medium">All cycles (pond total)</span> in{' '}
            <span className="font-medium text-slate-800">Implied stock position</span> to see the full manual history for
            the pond, or open <span className="font-medium text-slate-800">Movements (all sources)</span> for sales,
            transfers, and manual lines together.
          </div>
        ) : null}
        {loading ? (
          <div className="space-y-2 py-6" aria-busy="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-100">
            <table className="min-w-full text-left text-sm">
              <thead className="sticky top-0 z-[1] bg-slate-50/95 backdrop-blur-sm">
                <tr className="border-b border-slate-200 text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="whitespace-nowrap px-3 py-2.5">Date</th>
                  <th className="px-3 py-2.5">Pond / cycle</th>
                  <th className="px-3 py-2.5">Kind</th>
                  <th className="px-3 py-2.5">Reason</th>
                  <th className="px-3 py-2.5">Species</th>
                  <th className="px-3 py-2.5 text-right">Δ fish</th>
                  <th className="px-3 py-2.5 text-right">Δ kg</th>
                  <th className="px-3 py-2.5 text-right">Book</th>
                  <th className="px-3 py-2.5">GL</th>
                  <th className="min-w-[8rem] px-3 py-2.5">Memo</th>
                  <th className="whitespace-nowrap px-2 py-2.5 text-right text-xs font-medium uppercase tracking-wide text-slate-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-10 text-center text-slate-500">
                      No ledger rows yet. Use <strong className="text-slate-700">Add entry</strong> for mortality,
                      predation, theft, or count/weight corrections.
                    </td>
                  </tr>
                ) : filteredLedgerRows.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-10 text-center text-slate-500">
                      No rows match your search.{' '}
                      <button
                        type="button"
                        onClick={() => setLedgerQuery('')}
                        className="font-medium text-teal-800 underline hover:text-teal-950"
                      >
                        Clear search
                      </button>
                    </td>
                  </tr>
                ) : (
                  filteredLedgerRows.map((r) => {
                    const fc = Number(r.fish_count_delta)
                    const wkg = Number(r.weight_kg_delta)
                    const deltaClass = (n: number) =>
                      n < 0 ? 'text-rose-700' : n > 0 ? 'text-emerald-700' : 'text-slate-600'
                    const kindBadge =
                      r.entry_kind === 'loss'
                        ? 'bg-rose-50 text-rose-900 ring-rose-100'
                        : 'bg-sky-50 text-sky-900 ring-sky-100'
                    const memoFull = (r.memo || '').trim()
                    const memoShort = memoFull.length > 48 ? `${memoFull.slice(0, 45)}…` : memoFull
                    return (
                      <tr
                        key={r.id}
                        className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/90"
                      >
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-800">
                          {formatDateOnly(r.entry_date)}
                        </td>
                        <td className="px-3 py-2.5">
                          <Link
                            href={`/aquaculture/ponds/${r.pond_id}`}
                            className="font-medium text-teal-800 hover:text-teal-950 hover:underline"
                          >
                            {r.pond_name}
                          </Link>
                          {r.production_cycle_name ? (
                            <div className="text-xs text-slate-500">{r.production_cycle_name}</div>
                          ) : null}
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${kindBadge}`}
                          >
                            {r.entry_kind_label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-600">{r.loss_reason_label || r.loss_reason || '—'}</td>
                        <td className="px-3 py-2.5 text-slate-600">{r.fish_species_label?.trim() || '—'}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${deltaClass(fc)}`}>
                          {formatNumber(fc, 0)}
                        </td>
                        <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${deltaClass(wkg)}`}>
                          {formatNumber(wkg, 2)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                          {parseFloat(r.book_value) > 0 ? `${sym}${formatNumber(parseFloat(r.book_value), 2)}` : '—'}
                        </td>
                        <td className="px-3 py-2.5">
                          {r.post_to_books ? (
                            <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-900 ring-1 ring-inset ring-emerald-100">
                              {r.journal_entry_number || 'Posted'}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="max-w-[12rem] px-3 py-2.5 text-xs text-slate-600" title={memoFull || undefined}>
                          {memoShort || '—'}
                        </td>
                        <td className="px-2 py-2.5">
                          <div
                            className="flex items-center justify-end gap-1 rounded-md border border-slate-100 bg-slate-50/50 p-0.5"
                            role="group"
                            aria-label="Row actions"
                          >
                            <button
                              type="button"
                              onClick={() => openEdit(r)}
                              className={iconAction}
                              title={r.journal_entry_id ? 'Edit memo (GL-linked row)' : 'Edit entry'}
                            >
                              <Pencil className="h-4 w-4" aria-hidden />
                              <span className="sr-only">Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setRollbackTarget(r)}
                              className={iconActionDanger}
                              title="Rollback entry — reverse deltas and remove automatic GL if applicable"
                            >
                              <Undo2 className="h-4 w-4" aria-hidden />
                              <span className="sr-only">Rollback entry</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
              {filteredLedgerRows.length > 0 ? (
                <tfoot className="bg-slate-50/80 text-sm font-medium text-slate-700">
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-right uppercase text-xs tracking-wide text-slate-500">
                      {ledgerQuery.trim() ? 'Totals (visible after search)' : 'Totals (loaded rows)'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(visibleLedgerTotals.fish, 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatNumber(visibleLedgerTotals.kg, 2)}</td>
                    <td colSpan={4} className="px-3 py-2 text-xs font-normal text-slate-500">
                      {!ledgerQuery.trim() && ledgerListMeta != null ? (
                        <>
                          Full-history manual Δ: {formatNumber(ledgerListMeta.total_fish_count_delta, 0)} fish ·{' '}
                          {formatNumber(Number(ledgerListMeta.total_weight_kg_delta), 2)} kg
                          {ledgerListMeta.returned < ledgerListMeta.total_row_count
                            ? ` · showing ${ledgerListMeta.returned} of ${ledgerListMeta.total_row_count}`
                            : null}
                          {ledgerListMeta.returned < ledgerListMeta.total_row_count
                            ? ' (scroll policy: newest first)'
                            : null}
                        </>
                      ) : !ledgerQuery.trim() ? (
                        <>Should match “Manual ledger Δ” in implied position for this filter.</>
                      ) : null}
                    </td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        )}
      </section>
      ) : null}

      {fishSubTab === 'movements' ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Movements (all sources)</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Every event that moved fish biomass: vendor stocking, transfers in/out, sales, manual losses and
                adjustments. Read-only — open the source document to edit or void.{' '}
                <span className="font-medium text-slate-600">Jointly (all species):</span> leave species as “All species”
                above. <span className="font-medium text-slate-600">Singly:</span> pick a species there — this list
                matches. <span className="font-medium text-slate-600">Ins vs outs:</span> positive Δ fish/kg are adds
                (stocking, transfer in, positive adjustments); negative are removals (sales, transfer out, losses). Or
                filter <span className="font-medium text-slate-600">Source</span> to only ins (e.g. transfer in, vendor)
                or only outs (sale, transfer out, loss).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[12rem] flex-1 sm:max-w-xs sm:flex-initial">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden
                />
                <input
                  type="search"
                  value={movQuery}
                  onChange={(e) => setMovQuery(e.target.value)}
                  placeholder="Search source, pond, memo, journal…"
                  className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  aria-label="Search movements"
                />
              </div>
            </div>
          </div>
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs font-medium text-slate-600">
              Pond
              <select
                value={movPond}
                onChange={(e) => setMovPond(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">All ponds</option>
                {ponds.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              Source
              <select
                value={movSource}
                onChange={(e) => setMovSource(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              >
                <option value="">All sources</option>
                {movementsSources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              From
              <input
                type="date"
                value={movFrom}
                onChange={(e) => setMovFrom(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              To
              <input
                type="date"
                value={movTo}
                onChange={(e) => setMovTo(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
          </div>
          {movementsListCap != null &&
          movementsListCap.returned > 0 &&
          movementsListCap.returned >= movementsListCap.limit ? (
            <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs text-amber-950">
              <span className="font-medium">List capped at {movementsListCap.limit} rows.</span> The API returns the most
              recent events first; older dates may be missing until you narrow the filter (pond, source, or date range).
            </div>
          ) : null}
          {movementsLoading ? (
            <div className="space-y-2 py-6" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-100">
              <table className="min-w-full text-left text-sm">
                <thead className="sticky top-0 z-[1] bg-slate-50/95 backdrop-blur-sm">
                  <tr className="border-b border-slate-200 text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="whitespace-nowrap px-3 py-2.5">Date</th>
                    <th className="px-3 py-2.5">Pond</th>
                    <th className="px-3 py-2.5">Source</th>
                    <th className="px-3 py-2.5">Reason / species</th>
                    <th className="px-3 py-2.5 text-right">Δ fish</th>
                    <th className="px-3 py-2.5 text-right">Δ kg</th>
                    <th className="px-3 py-2.5 text-right">Value</th>
                    <th className="min-w-[8rem] px-3 py-2.5">Memo</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMovements.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-10 text-center text-slate-500">
                        {movements.length === 0
                          ? 'No biomass movements yet for this filter.'
                          : 'No rows match your search.'}
                      </td>
                    </tr>
                  ) : (
                    filteredMovements.map((r) => {
                      const fc = Number(r.fish_count_delta)
                      const wkg = Number(r.weight_kg_delta)
                      const val = Number(r.value_amount)
                      const deltaClass = (n: number) =>
                        n < 0 ? 'text-rose-700' : n > 0 ? 'text-emerald-700' : 'text-slate-600'
                      const sourceBadge: Record<string, string> = {
                        vendor_bill: 'bg-emerald-50 text-emerald-900 ring-emerald-100',
                        transfer_in: 'bg-sky-50 text-sky-900 ring-sky-100',
                        transfer_out: 'bg-amber-50 text-amber-900 ring-amber-100',
                        sale: 'bg-indigo-50 text-indigo-900 ring-indigo-100',
                        ledger_loss: 'bg-rose-50 text-rose-900 ring-rose-100',
                        ledger_adjustment: 'bg-slate-100 text-slate-800 ring-slate-200',
                      }
                      const badge = sourceBadge[r.source] || 'bg-slate-100 text-slate-800 ring-slate-200'
                      const reason = r.loss_reason_label || r.fish_species_label || ''
                      const memoFull = (r.memo || '').trim()
                      const memoShort = memoFull.length > 48 ? `${memoFull.slice(0, 45)}…` : memoFull
                      const key = `${r.source}-${r.source_id}-${r.entry_date}-${r.pond_id}-${r.fish_count_delta}`
                      return (
                        <tr key={key} className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/90">
                          <td className="whitespace-nowrap px-3 py-2.5 text-slate-800">
                            {formatDateOnly(r.entry_date)}
                          </td>
                          <td className="px-3 py-2.5">
                            <Link
                              href={`/aquaculture/ponds/${r.pond_id}`}
                              className="font-medium text-teal-800 hover:text-teal-950 hover:underline"
                            >
                              {r.pond_name || `Pond #${r.pond_id}`}
                            </Link>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${badge}`}>
                              {r.source_label}
                            </span>
                            <div className="mt-0.5 text-xs text-slate-500">{r.source_doc}</div>
                          </td>
                          <td className="px-3 py-2.5 text-slate-600">{reason || '—'}</td>
                          <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${deltaClass(fc)}`}>
                            {formatNumber(fc, 0)}
                          </td>
                          <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${deltaClass(wkg)}`}>
                            {formatNumber(wkg, 2)}
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                            {val > 0 ? `${sym}${formatNumber(val, 2)}` : '—'}
                          </td>
                          <td className="max-w-[12rem] px-3 py-2.5 text-xs text-slate-600" title={memoFull || undefined}>
                            {memoShort || '—'}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
                {filteredMovements.length > 0 ? (
                  <tfoot className="bg-slate-50/80 text-sm font-medium text-slate-700">
                    <tr>
                      <td colSpan={4} className="px-3 py-2 text-right uppercase text-xs tracking-wide text-slate-500">
                        Totals ({filteredMovements.length})
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(movementsTotals.fish, 0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(movementsTotals.kg, 2)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {sym}
                        {formatNumber(movementsTotals.value, 2)}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          )}
        </section>
      ) : null}
        </div>
      ) : null}

      {mainTab === 'warehouse' ? (
        <div id="stock-panel-warehouse" role="tabpanel" aria-labelledby="stock-tab-warehouse">
          <div
            className="mb-4 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1 shadow-inner"
            role="tablist"
            aria-label="Warehouse view"
          >
            <button
              type="button"
              role="tab"
              aria-selected={whSubTab === 'on_hand'}
              onClick={() => setWhSubTab('on_hand')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                whSubTab === 'on_hand'
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5 text-current opacity-90" aria-hidden />
                On hand
              </span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={whSubTab === 'consumed'}
              onClick={() => setWhSubTab('consumed')}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                whSubTab === 'consumed'
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <Beaker className="h-3.5 w-3.5 text-current opacity-90" aria-hidden />
                Consumed (feed &amp; medicine)
              </span>
            </button>
          </div>

          {whSubTab === 'on_hand' ? (
          <>
          <AquacultureWarehouseGroupsPanel onChanged={() => void loadWarehouseMatrix()} />
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm mt-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Pond warehouse on hand</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Current quantities by pond and SKU. Filter by pond (loads from server), then narrow by product type or
                  search.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setInterPondOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
                >
                  <ArrowRightLeft className="h-4 w-4" aria-hidden />
                  Move between ponds
                </button>
                <button
                  type="button"
                  onClick={() => setAddWhOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-800"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Add stock
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="block min-w-[11rem] text-xs font-medium text-slate-600">
                Pond
                <select
                  value={whPond}
                  onChange={(e) => setWhPond(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  aria-label="Filter warehouse stock by pond"
                >
                  <option value="">All ponds</option>
                  {ponds.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block min-w-[11rem] text-xs font-medium text-slate-600">
                Product type
                <select
                  value={whPosCategory}
                  onChange={(e) => setWhPosCategory(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  aria-label="Filter by POS category"
                >
                  <option value="">All types</option>
                  {whPosCategoryOptions.map((c) => (
                    <option key={c} value={c}>
                      {warehouseShelfLabel(c)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="relative min-w-[12rem] flex-1 sm:max-w-xs">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                  aria-hidden
                />
                <input
                  type="search"
                  value={whSearch}
                  onChange={(e) => setWhSearch(e.target.value)}
                  placeholder="Search product, pond, category…"
                  className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                  aria-label="Search warehouse stock"
                />
              </div>
            </div>
            <div className="mt-4 overflow-x-auto">
              {whLoading ? (
                <p className="py-8 text-center text-sm text-slate-500">Loading pond warehouse…</p>
              ) : filteredWhRows.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">
                  {whRows.length === 0
                    ? 'No pond warehouse stock yet. Click Add stock above to move feed or medicine from your shop.'
                    : 'No rows match your filters.'}{' '}
                  {whRows.length > 0 && (whSearch.trim() || whPosCategory) ? (
                    <button
                      type="button"
                      onClick={() => {
                        setWhSearch('')
                        setWhPosCategory('')
                      }}
                      className="font-medium text-teal-800 underline hover:text-teal-950"
                    >
                      Clear filters
                    </button>
                  ) : null}
                </p>
              ) : (
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                      <th className="py-2 pr-4">Pond</th>
                      <th className="py-2 pr-4">Shared group</th>
                      <th className="py-2 pr-4">Product</th>
                      <th className="py-2 pr-4">Type</th>
                      <th className="py-2 pr-4">Category</th>
                      <th className="py-2 pr-4 text-right">On hand</th>
                      <th className="py-2 pr-4 text-right">Ext. value</th>
                      <th className="py-2"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredWhRows.map((r) => {
                      const q = Number(r.quantity)
                      const uc = Number(r.unit_cost)
                      const ext = Number.isFinite(q) && Number.isFinite(uc) ? q * uc : null
                      return (
                        <tr key={`${r.pond_id}-${r.item_id}`} className="border-b border-slate-100 hover:bg-slate-50/80">
                          <td className="py-2 pr-4 font-medium text-slate-800">
                            <Link
                              href={`/aquaculture/ponds/${r.pond_id}`}
                              className="inline-flex items-center gap-1 text-teal-800 hover:text-teal-950 hover:underline"
                            >
                              {r.pond_name}
                              <ExternalLink className="h-3 w-3 opacity-60" aria-hidden />
                            </Link>
                          </td>
                          <td className="py-2 pr-4 text-slate-600">
                            {r.warehouse_group_name ? (
                              <span className="rounded bg-teal-50 px-1.5 py-0.5 text-xs font-medium text-teal-900">
                                {r.warehouse_group_name}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="py-2 pr-4 text-slate-800">{r.item_name}</td>
                          <td className="py-2 pr-4 text-slate-600">{warehouseShelfLabel(r.pos_category)}</td>
                          <td className="py-2 pr-4 text-slate-600">{r.reporting_category}</td>
                          <td className="py-2 pr-4 text-right tabular-nums text-slate-800">
                            {formatNumber(q, 4)} {r.unit}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums text-slate-700">
                            {ext != null && Number.isFinite(ext) ? `${sym}${formatNumber(ext, 2)}` : '—'}
                          </td>
                          <td className="py-2 text-right">
                            <Link
                              href={`/aquaculture/ponds/${r.pond_id}`}
                              className="text-xs font-medium text-teal-800 hover:underline"
                            >
                              Pond detail
                            </Link>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>
          </>
          ) : null}

          {whSubTab === 'consumed' ? (
            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Feed &amp; medicine consumed</h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Posted from feeding-advice apply or manual pond-warehouse consumption. Each row is paired with a
                    COGS journal entry (Dr COGS / Cr inventory at average cost).
                  </p>
                </div>
                <div className="relative min-w-[12rem] sm:max-w-xs">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden
                  />
                  <input
                    type="search"
                    value={conQuery}
                    onChange={(e) => setConQuery(e.target.value)}
                    placeholder="Search pond, memo, journal…"
                    className="w-full rounded-lg border border-slate-200 py-2 pl-8 pr-3 text-sm placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    aria-label="Search consumption"
                  />
                </div>
              </div>
              <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-xs font-medium text-slate-600">
                  Pond
                  <select
                    value={conPond}
                    onChange={(e) => setConPond(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    <option value="">All ponds</option>
                    {ponds.map((p) => (
                      <option key={p.id} value={String(p.id)}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-medium text-slate-600">
                  Type
                  <select
                    value={conKind}
                    onChange={(e) => setConKind(e.target.value as '' | 'feed' | 'medicine')}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  >
                    <option value="">Feed and medicine</option>
                    <option value="feed">Feed only</option>
                    <option value="medicine">Medicine only</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-slate-600">
                  From
                  <input
                    type="date"
                    value={conFrom}
                    onChange={(e) => setConFrom(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </label>
                <label className="text-xs font-medium text-slate-600">
                  To
                  <input
                    type="date"
                    value={conTo}
                    onChange={(e) => setConTo(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                  />
                </label>
              </div>
              {consumptionLoading ? (
                <div className="space-y-2 py-6" aria-busy="true">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
                  ))}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-slate-100">
                  <table className="min-w-full text-left text-sm">
                    <thead className="sticky top-0 z-[1] bg-slate-50/95 backdrop-blur-sm">
                      <tr className="border-b border-slate-200 text-xs font-medium uppercase tracking-wide text-slate-500">
                        <th className="whitespace-nowrap px-3 py-2.5">Date</th>
                        <th className="px-3 py-2.5">Pond / cycle</th>
                        <th className="px-3 py-2.5">Type</th>
                        <th className="px-3 py-2.5">Source</th>
                        <th className="px-3 py-2.5 text-right">Feed kg</th>
                        <th className="px-3 py-2.5 text-right">Sacks</th>
                        <th className="px-3 py-2.5 text-right">COGS</th>
                        <th className="px-3 py-2.5">GL</th>
                        <th className="min-w-[8rem] px-3 py-2.5">Memo</th>
                        <th className="w-[4rem] px-2 py-2.5 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredConsumption.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="px-3 py-10 text-center text-slate-500">
                            {consumption.length === 0
                              ? 'No feed or medicine has been consumed for this filter yet. Apply feeding advice or use pond-warehouse consume.'
                              : 'No rows match your search.'}
                          </td>
                        </tr>
                      ) : (
                        filteredConsumption.map((r) => {
                          const memoFull = (r.memo || '').trim()
                          const memoShort = memoFull.length > 48 ? `${memoFull.slice(0, 45)}…` : memoFull
                          const kindBadge =
                            r.kind === 'feed'
                              ? 'bg-emerald-50 text-emerald-900 ring-emerald-100'
                              : 'bg-violet-50 text-violet-900 ring-violet-100'
                          return (
                            <tr
                              key={`con-${r.id}`}
                              className="border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50/90"
                            >
                              <td className="whitespace-nowrap px-3 py-2.5 text-slate-800">
                                {formatDateOnly(r.entry_date)}
                              </td>
                              <td className="px-3 py-2.5">
                                <Link
                                  href={`/aquaculture/ponds/${r.pond_id}`}
                                  className="font-medium text-teal-800 hover:text-teal-950 hover:underline"
                                >
                                  {r.pond_name || `Pond #${r.pond_id}`}
                                </Link>
                                {r.production_cycle_name ? (
                                  <div className="text-xs text-slate-500">{r.production_cycle_name}</div>
                                ) : null}
                              </td>
                              <td className="px-3 py-2.5">
                                <span
                                  className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${kindBadge}`}
                                >
                                  {r.kind_label}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-xs text-slate-600">
                                {r.feeding_advice_id ? (
                                  <Link
                                    href="/aquaculture/feeding"
                                    className="text-teal-800 hover:text-teal-950 hover:underline"
                                  >
                                    {r.source_doc}
                                  </Link>
                                ) : (
                                  r.source_doc
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                                {r.feed_weight_kg ? formatNumber(Number(r.feed_weight_kg), 2) : '—'}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                                {r.feed_sack_count ? formatNumber(Number(r.feed_sack_count), 2) : '—'}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                                {sym}
                                {formatNumber(Number(r.amount), 2)}
                              </td>
                              <td className="px-3 py-2.5">
                                {r.journal_entry_number ? (
                                  <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-900 ring-1 ring-inset ring-emerald-100">
                                    {r.journal_entry_number}
                                  </span>
                                ) : (
                                  <span className="text-xs text-slate-400">—</span>
                                )}
                              </td>
                              <td
                                className="max-w-[12rem] px-3 py-2.5 text-xs text-slate-600"
                                title={memoFull || undefined}
                              >
                                {memoShort || '—'}
                              </td>
                              <td className="px-2 py-2 text-center">
                                <button
                                  type="button"
                                  disabled={consumptionDeleteBusyId === r.id}
                                  onClick={() => void deleteConsumptionRow(r)}
                                  className={iconActionDanger}
                                  title="Delete and reverse stock / COGS"
                                  aria-label={`Delete ${r.kind_label} on ${r.pond_name}`}
                                >
                                  <Trash2 className="h-4 w-4" aria-hidden />
                                </button>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                    {filteredConsumption.length > 0 ? (
                      <tfoot className="bg-slate-50/80 text-sm font-medium text-slate-700">
                        <tr>
                          <td colSpan={4} className="px-3 py-2 text-right uppercase text-xs tracking-wide text-slate-500">
                            Totals ({filteredConsumption.length})
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatNumber(consumptionTotals.kg, 2)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {formatNumber(consumptionTotals.sacks, 2)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {sym}
                            {formatNumber(consumptionTotals.amount, 2)}
                          </td>
                          <td colSpan={3} />
                        </tr>
                      </tfoot>
                    ) : null}
                  </table>
                </div>
              )}
            </section>
          ) : null}
        </div>
      ) : null}

      <AquacultureStockLedgerFormModal
        open={modal}
        editing={editingRow}
        ponds={ponds}
        refData={ref}
        fishSpecies={fishSpecies}
        currency={currency}
        defaultPondId={posPond || undefined}
        defaultCycleId={posCycle || undefined}
        defaultSpecies={posSpecies || undefined}
        onClose={closeLedgerModal}
        onSaved={() => {
          void loadRows()
          void loadPosition()
        }}
      />

      {rollbackTarget ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !rollbackBusy) setRollbackTarget(null)
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="rollback-dialog-title"
            aria-describedby="rollback-dialog-desc"
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-700">
                <Undo2 className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h3 id="rollback-dialog-title" className="text-lg font-semibold text-slate-900">
                  Roll back this ledger entry?
                </h3>
                <p id="rollback-dialog-desc" className="mt-2 text-sm leading-relaxed text-slate-600">
                  This permanently removes the row and <strong className="font-medium text-slate-800">reverses</strong>{' '}
                  its fish count and weight deltas in implied stock.
                  {rollbackTarget.journal_entry_id ? (
                    <>
                      {' '}
                      The automatic journal{' '}
                      <span className="font-mono text-xs text-slate-700">
                        {(rollbackTarget.journal_entry_number || '').trim() || `#${rollbackTarget.journal_entry_id}`}
                      </span>{' '}
                      is deleted when it matches the system fish-stock entry for this row. If rollback fails, adjust the
                      journal in the GL first.
                    </>
                  ) : (
                    <> No general-ledger journal was posted for this row.</>
                  )}
                </p>
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  {formatDateOnly(rollbackTarget.entry_date)} · {rollbackTarget.pond_name} ·{' '}
                  {rollbackTarget.entry_kind_label} · Δ {formatNumber(Number(rollbackTarget.fish_count_delta), 0)} fish,{' '}
                  {formatNumber(Number(rollbackTarget.weight_kg_delta), 2)} kg
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
              <button
                type="button"
                disabled={rollbackBusy}
                onClick={() => setRollbackTarget(null)}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={rollbackBusy}
                onClick={() => void executeRollback()}
                className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-rose-700 disabled:opacity-60"
              >
                {rollbackBusy ? (
                  <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <Undo2 className="h-4 w-4" aria-hidden />
                )}
                Roll back entry
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <PondWarehouseAddStockModal
        open={addWhOpen}
        onClose={() => setAddWhOpen(false)}
        initialPondId={whPond ? parseInt(whPond, 10) : null}
        onSuccess={() => {
          if (mainTab === 'warehouse' && whSubTab === 'on_hand') void loadWarehouseMatrix()
        }}
      />
      <PondWarehouseInterPondModal
        open={interPondOpen}
        onClose={() => setInterPondOpen(false)}
        initialFromPondId={whPond ? parseInt(whPond, 10) : null}
        onSuccess={() => {
          if (mainTab === 'warehouse' && whSubTab === 'on_hand') void loadWarehouseMatrix()
        }}
      />
    </div>
  )
}

export default function AquacultureStockPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-4 py-12 text-center text-sm text-slate-600">Loading pond stock…</div>
      }
    >
      <AquacultureStockPageContent />
    </Suspense>
  )
}
