'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus,
  Edit2,
  Trash2,
  RefreshCw,
  LayoutGrid,
  List,
  Store,
  BookOpen,
  Eye,
  Search,
  Fish,
  Droplets,
  Wallet,
  ChevronDown,
  Sparkles,
  Landmark,
} from 'lucide-react'
import { PondOpeningBalancesModal, type PondOpeningSource } from '@/components/aquaculture/PondOpeningBalancesModal'
import {
  PondGoLiveFleetBanner,
  PondGoLiveReadinessBadge,
} from '@/components/aquaculture/PondGoLiveFleetBanner'
import type { OpeningBalancesResponse } from '@/components/aquaculture/pondOpeningShared'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { REFERENCE_FETCH_LIMIT } from '@/lib/pagination'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatDateOnly } from '@/utils/date'
import { formatNumber } from '@/utils/currency'

interface CustomerOpt {
  id: number
  display_name?: string | null
  company_name?: string | null
  customer_number?: string | null
  is_active?: boolean
  default_station_id?: number | null
  default_station_name?: string | null
}

interface Pond extends PondOpeningSource {
  sort_order: number
  notes: string
  pond_role?: string
  pond_role_label?: string
  warehouse_group_id?: number | null
  warehouse_group_name?: string
  pos_customer_id?: number | null
  pos_customer_display?: string | null
  pos_customer_auto_managed?: boolean
  leasing_area_decimal: string | null
  water_area_decimal: string | null
  pond_depth_ft: string | null
  water_surface_sq_ft?: string | null
  water_volume_cu_ft?: string | null
  /** Tilapia-only implied net fish from movements (transfers, sales, ledger). */
  tilapia_net_fish_count?: number | null
  /** Tilapia-only implied net biomass (kg). */
  tilapia_net_weight_kg?: string | null
  /** Tilapia kg per water-surface decimal; needs water_area_decimal on the pond. */
  tilapia_kg_per_decimal?: string | null
  tilapia_kg_per_1000_cu_ft?: string | null
  tilapia_load_level?: string | null
  tilapia_load_level_label?: string | null
  lease_contract_start: string | null
  lease_contract_end: string | null
  lease_price_per_decimal_per_year: string | null
  lease_paid_to_landlord: string
  lease_annual_amount: string | null
  lease_contract_years: string | null
  lease_contract_total: string | null
  lease_remaining_years: number | null
  lease_remaining_months: number | null
  lease_balance_due: string | null
  created_at?: string
}

function customerPickLabel(c: CustomerOpt, ponds: Pond[]): string {
  const co = (c.company_name || '').trim()
  const d = (c.display_name || '').trim()
  const base = co || d || ((c.customer_number || '').trim() ? `Customer ${c.customer_number}` : `Customer #${c.id}`)
  const linkedPond = ponds.find((p) => p.pos_customer_id === c.id)
  const isAquaculture =
    Boolean(linkedPond) || d.startsWith('Aquaculture') || d.startsWith('Aquaculture —')
  if (!isAquaculture) return base
  const site = (c.default_station_name || '').trim()
  const pondHint = linkedPond ? linkedPond.name : d.replace(/^Aquaculture\s*—\s*/i, '').trim()
  const bits = [base]
  if (pondHint && !base.toLowerCase().includes(pondHint.toLowerCase())) bits.push(`(${pondHint})`)
  if (site) bits.push(`· ${site}`)
  bits.push('· on-account')
  return bits.join(' ')
}

function parseDecimalInput(s: string): number | null {
  const t = s.trim().replace(/,/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function parseMoneyInput(s: string): number {
  const t = s.trim().replace(/,/g, '')
  if (!t) return 0
  const n = Number(t)
  return Number.isFinite(n) ? n : 0
}

/** Parses P01 / p02 style pond codes for gap-fill ordering (only P + digits count). */
function pondCodeSerial(code: string): number | null {
  const m = /^[pP](\d+)$/.exec((code || '').trim())
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) ? n : null
}

/** Next code matching backend: smallest missing serial, padding aligned with existing P-codes. */
function suggestNextPondCode(existingCodes: string[]): string {
  const nums = new Set<number>()
  for (const c of existingCodes) {
    const n = pondCodeSerial(c)
    if (n !== null) nums.add(n)
  }
  let m = 1
  while (nums.has(m)) m += 1
  let width = Math.max(2, String(m).length)
  if (nums.size > 0) {
    width = Math.max(width, ...[...nums].map((x) => String(x).length))
  }
  return `P${String(m).padStart(width, '0')}`
}

function parseLocalDate(iso: string | null): Date | null {
  if (!iso) return null
  const d = iso.split('T')[0]
  const [y, m, day] = d.split('-').map(Number)
  if (!y || !m || !day) return null
  return new Date(y, m - 1, day)
}

function contractYearFraction(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime()
  const days = ms / 86400000
  if (days <= 0) return 0
  return days / 365.25
}

function remainingYearsMonths(periodStart: Date, periodEnd: Date): { years: number; months: number } {
  if (periodStart > periodEnd) return { years: 0, months: 0 }
  let y = periodEnd.getFullYear() - periodStart.getFullYear()
  let m = periodEnd.getMonth() - periodStart.getMonth()
  const dEnd = periodEnd.getDate()
  const dStart = periodStart.getDate()
  if (dEnd < dStart) m -= 1
  if (m < 0) {
    y -= 1
    m += 12
  }
  return { years: Math.max(0, y), months: Math.max(0, m) }
}

function fmtMoney(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return formatNumber(n, digits)
}

function pondAreasCell(p: Pond): string {
  const bits: string[] = []
  if (p.leasing_area_decimal) bits.push(`L ${p.leasing_area_decimal} dec`)
  if (p.water_area_decimal) bits.push(`W ${p.water_area_decimal} dec`)
  if (p.pond_depth_ft) bits.push(`${p.pond_depth_ft} ft`)
  if (p.water_volume_cu_ft) bits.push(`${formatNumber(Number(p.water_volume_cu_ft), 0)} cu ft`)
  return bits.length ? bits.join(' · ') : '—'
}

function tilapiaLoadBadgeClass(level: string | null | undefined): string {
  switch (level) {
    case 'understocked':
      return 'bg-sky-50 text-sky-900'
    case 'moderate':
      return 'bg-emerald-50 text-emerald-800'
    case 'full':
      return 'bg-amber-50 text-amber-900'
    case 'high_risk':
      return 'bg-red-50 text-red-900'
    default:
      return 'bg-slate-100 text-slate-600'
  }
}

function PondTilapiaLoadCell({ p }: { p: Pond }) {
  const fish = p.tilapia_net_fish_count
  const kgStr = p.tilapia_net_weight_kg
  const kg = kgStr != null && kgStr !== '' ? Number(kgStr) : null
  const kpdStr = p.tilapia_kg_per_decimal
  const kpd = kpdStr != null && kpdStr !== '' ? Number(kpdStr) : null
  const label = (p.tilapia_load_level_label || '').trim()
  const level = p.tilapia_load_level

  if (
    (fish == null || Number.isNaN(Number(fish))) &&
    (kg == null || Number.isNaN(kg)) &&
    (kpd == null || Number.isNaN(kpd)) &&
    !label
  ) {
    return <span className="text-slate-400">—</span>
  }

  return (
    <div className="space-y-1 text-xs text-slate-700">
      <p className="tabular-nums">
        {fish != null && !Number.isNaN(Number(fish)) ? (
          <span>{formatNumber(Number(fish), 0)} tilapia</span>
        ) : (
          <span className="text-slate-400">Fish —</span>
        )}
        <span className="text-slate-300"> · </span>
        {kg != null && !Number.isNaN(kg) ? (
          <span>{formatNumber(kg, 2)} kg pond</span>
        ) : (
          <span className="text-slate-400">kg —</span>
        )}
      </p>
      <p className="tabular-nums text-slate-600">
        {kpd != null && !Number.isNaN(kpd) ? (
          <span title="Kilograms of tilapia biomass per decimal of water surface">
            {formatNumber(kpd, 3)} kg/dec
          </span>
        ) : (
          <span className="text-slate-400" title="Set water area (decimal) on the pond to compute kg per decimal">
            kg/dec —
          </span>
        )}
      </p>
      {label ? (
        <span
          className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${tilapiaLoadBadgeClass(level)}`}
        >
          {label}
        </span>
      ) : null}
    </div>
  )
}

function computeLeasePreview(form: {
  leasing_area_decimal: string
  lease_price_per_decimal_per_year: string
  lease_contract_start: string
  lease_contract_end: string
  lease_paid_to_landlord: string
}) {
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const size = parseDecimalInput(form.leasing_area_decimal)
  const price = parseDecimalInput(form.lease_price_per_decimal_per_year)
  const paid = parseMoneyInput(form.lease_paid_to_landlord)
  const start = parseLocalDate(form.lease_contract_start || null)
  const end = parseLocalDate(form.lease_contract_end || null)

  const annual = size !== null && price !== null ? size * price : null
  let contractYearsRounded: number | null = null
  let total: number | null = null
  if (start && end && end >= start) {
    contractYearsRounded = Math.round(contractYearFraction(start, end))
    if (annual !== null) total = annual * contractYearsRounded
  }
  let remY: number | null = null
  let remM: number | null = null
  if (end) {
    const ref = start && today < start ? start : today
    const r = remainingYearsMonths(ref, end)
    remY = r.years
    remM = r.months
  }
  const balance = total !== null ? total - paid : null
  return { annual, contractYearsRounded, total, remY, remM, balance }
}

const POND_ROLE_OPTIONS: { id: string; label: string }[] = [
  { id: 'grow_out', label: 'Grow-out' },
  { id: 'nursing', label: 'Nursing / nursery' },
  { id: 'broodstock', label: 'Broodstock' },
  { id: 'other', label: 'Other' },
]

const emptyForm = () => ({
  name: '',
  code: '',
  sort_order: '0',
  is_active: true,
  notes: '',
  pond_role: 'grow_out',
  warehouse_group_id: '',
  pos_customer_id: '',
  leasing_area_decimal: '',
  water_area_decimal: '',
  pond_depth_ft: '',
  lease_contract_start: '',
  lease_contract_end: '',
  lease_price_per_decimal_per_year: '',
  lease_paid_to_landlord: '0',
})

type ViewMode = 'list' | 'cards'

type StatusFilter = 'all' | 'active' | 'inactive'

function parseOptionalNumber(s: string | null | undefined): number | null {
  if (s == null || String(s).trim() === '') return null
  const n = Number(String(s).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

function balanceTone(balanceStr: string | null | undefined): string {
  if (balanceStr === null || balanceStr === undefined) return 'text-slate-600'
  const bal = Number(balanceStr)
  if (Number.isNaN(bal)) return 'text-slate-600'
  if (bal > 0) return 'text-amber-800'
  if (bal < 0) return 'text-emerald-800'
  return 'text-slate-700'
}

function PondLeaseCell({ p }: { p: Pond }) {
  const bal =
    p.lease_balance_due !== null && p.lease_balance_due !== undefined ? Number(p.lease_balance_due) : null
  const hasPeriod = Boolean(p.lease_contract_start || p.lease_contract_end)
  const annual = p.lease_annual_amount ? Number(p.lease_annual_amount) : null
  const paid = Number(p.lease_paid_to_landlord)
  const rem =
    p.lease_remaining_years !== null && p.lease_remaining_months !== null
      ? `${p.lease_remaining_years}y ${p.lease_remaining_months}m`
      : null

  if (!hasPeriod && annual === null && paid === 0 && (bal === null || Number.isNaN(bal))) {
    return <span className="text-slate-400">—</span>
  }

  return (
    <div className="space-y-1.5 text-xs text-slate-700">
      {hasPeriod ? (
        <p className="font-medium text-slate-800">
          {formatDateOnly(p.lease_contract_start)} → {formatDateOnly(p.lease_contract_end)}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 tabular-nums sm:grid-cols-3">
        <p>
          <span className="text-slate-500">Annual</span>{' '}
          <span className="font-medium text-slate-900">{fmtMoney(annual)}</span>
        </p>
        <p>
          <span className="text-slate-500">Paid</span>{' '}
          <span className="font-medium text-slate-900">{fmtMoney(paid)}</span>
        </p>
        <p className="col-span-2 sm:col-span-1">
          <span className="text-slate-500">Balance</span>{' '}
          <span className={`font-semibold ${balanceTone(p.lease_balance_due)}`}>
            {bal === null || Number.isNaN(bal)
              ? '—'
              : bal > 0
                ? `${fmtMoney(bal)} due`
                : bal < 0
                  ? `${fmtMoney(bal)} adv.`
                  : fmtMoney(0)}
          </span>
        </p>
      </div>
      {rem ? (
        <p className="text-[11px] text-slate-500">
          Remaining <span className="font-medium text-slate-700">{rem}</span>
        </p>
      ) : null}
    </div>
  )
}

export default function AquaculturePondsPage() {
  const toast = useToast()
  const [ponds, setPonds] = useState<Pond[]>([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<Pond | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [customers, setCustomers] = useState<CustomerOpt[]>([])
  const [customersLoading, setCustomersLoading] = useState(false)
  const [provisioningCustomers, setProvisioningCustomers] = useState(false)
  const [skipAutoPosCustomer, setSkipAutoPosCustomer] = useState(false)
  const [warehouseGroups, setWarehouseGroups] = useState<{ id: number; name: string }[]>([])
  const [openingModal, setOpeningModal] = useState(false)
  const [currency, setCurrency] = useState('BDT')
  const [goLiveFleet, setGoLiveFleet] = useState<NonNullable<OpeningBalancesResponse['go_live']> | null>(
    null,
  )
  const [goLiveCutoverDate, setGoLiveCutoverDate] = useState<string | null>(null)
  const [goLiveByPondId, setGoLiveByPondId] = useState<
    Map<number, { readinessPercent: number; ready: boolean }>
  >(() => new Map())
  const [goLiveLoading, setGoLiveLoading] = useState(false)

  const pondsMissingPosCustomer = useMemo(
    () => ponds.filter((p) => !p.pos_customer_id),
    [ponds],
  )

  const preview = useMemo(() => computeLeasePreview(form), [form])

  const filteredPonds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return ponds.filter((p) => {
      if (statusFilter === 'active' && !p.is_active) return false
      if (statusFilter === 'inactive' && p.is_active) return false
      if (!q) return true
      const hay = [p.name, p.code, p.notes, p.pos_customer_display, p.pond_role_label]
        .map((x) => (x || '').toLowerCase())
        .join(' ')
      return hay.includes(q)
    })
  }, [ponds, searchQuery, statusFilter])

  const pondStats = useMemo(() => {
    let waterDec = 0
    let leaseDec = 0
    let biomassKg = 0
    let balanceDueSum = 0
    const active = ponds.filter((p) => p.is_active).length
    for (const p of ponds) {
      const w = parseOptionalNumber(p.water_area_decimal)
      if (w !== null) waterDec += w
      const l = parseOptionalNumber(p.leasing_area_decimal)
      if (l !== null) leaseDec += l
      const kg = parseOptionalNumber(p.tilapia_net_weight_kg)
      if (kg !== null) biomassKg += kg
      const bal = parseOptionalNumber(p.lease_balance_due)
      if (bal !== null) balanceDueSum += bal
    }
    return {
      total: ponds.length,
      active,
      waterDec,
      leaseDec,
      biomassKg,
      balanceDueSum,
    }
  }, [ponds])

  const load = useCallback(async () => {
    setLoading(true)
    setGoLiveLoading(true)
    try {
      const [pondsRes, openingRes] = await Promise.all([
        api.get<Pond[]>('/aquaculture/ponds/'),
        api.get<OpeningBalancesResponse>('/aquaculture/ponds/opening-balances/').catch(() => null),
      ])
      setPonds(Array.isArray(pondsRes.data) ? pondsRes.data : [])
      if (openingRes?.data) {
        setGoLiveFleet(openingRes.data.go_live ?? null)
        setGoLiveCutoverDate(openingRes.data.cutover_date?.slice(0, 10) ?? null)
        const next = new Map<number, { readinessPercent: number; ready: boolean }>()
        for (const row of openingRes.data.ponds ?? []) {
          next.set(row.pond_id, {
            readinessPercent: row.go_live?.readiness_percent ?? 0,
            ready: row.go_live?.ready ?? false,
          })
        }
        setGoLiveByPondId(next)
      } else {
        setGoLiveFleet(null)
        setGoLiveCutoverDate(null)
        setGoLiveByPondId(new Map())
      }
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load ponds'))
    } finally {
      setLoading(false)
      setGoLiveLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await api.get<Record<string, unknown>>('/companies/current/')
        setCurrency(String(data?.currency || 'BDT').slice(0, 3))
      } catch {
        /* keep default */
      }
    })()
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await api.get<{ id: number; name: string }[]>('/aquaculture/warehouse-groups/')
        setWarehouseGroups(
          (Array.isArray(data) ? data : [])
            .filter((g) => g && typeof g.id === 'number')
            .map((g) => ({ id: g.id, name: String(g.name || '') })),
        )
      } catch {
        setWarehouseGroups([])
      }
    })()
  }, [])

  const loadCustomersForModal = useCallback(async () => {
    setCustomersLoading(true)
    try {
      const { data } = await api.get<CustomerOpt[]>('/customers/', {
        params: { limit: REFERENCE_FETCH_LIMIT },
      })
      const fromApi = Array.isArray(data) ? data : []
      const byId = new Map<number, CustomerOpt>()
      for (const c of fromApi) byId.set(c.id, c)
      for (const p of ponds) {
        if (p.pos_customer_id == null) continue
        if (byId.has(p.pos_customer_id)) continue
        byId.set(p.pos_customer_id, {
          id: p.pos_customer_id,
          display_name: p.pos_customer_display || `Aquaculture — ${p.name}`,
          is_active: p.is_active,
        })
      }
      const merged = [...byId.values()].sort((a, b) => {
        const aAq = (a.display_name || '').startsWith('Aquaculture')
        const bAq = (b.display_name || '').startsWith('Aquaculture')
        if (aAq !== bAq) return aAq ? -1 : 1
        return (a.display_name || '').localeCompare(b.display_name || '', undefined, { sensitivity: 'base' })
      })
      setCustomers(merged)
    } catch {
      setCustomers([])
    } finally {
      setCustomersLoading(false)
    }
  }, [ponds])

  useEffect(() => {
    if (!modal) return
    void loadCustomersForModal()
  }, [modal, loadCustomersForModal])

  const provisionMissingPosCustomers = async () => {
    setProvisioningCustomers(true)
    try {
      const { data } = await api.post<{ created?: number[]; errors?: { pond_id: number; detail: string }[] }>(
        '/aquaculture/ponds/provision-pos-customers/',
        {},
      )
      const n = Array.isArray(data?.created) ? data.created.length : 0
      const errs = Array.isArray(data?.errors) ? data.errors : []
      if (errs.length > 0) {
        toast.error(errs[0]?.detail || 'Some ponds could not get a POS customer')
      }
      if (n > 0) {
        toast.success(
          `Created ${n} pond POS customer${n === 1 ? '' : 's'} (Aquaculture — …) for on-account sales at your shop hub`,
        )
        await load()
        if (modal) await loadCustomersForModal()
      } else if (errs.length === 0) {
        toast.success('Every pond already has a linked POS customer')
      }
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not create pond POS customers'))
    } finally {
      setProvisioningCustomers(false)
    }
  }

  const openNew = () => {
    setEditing(null)
    setSkipAutoPosCustomer(false)
    const nextCode = suggestNextPondCode(ponds.map((x) => x.code || ''))
    setForm({ ...emptyForm(), code: nextCode })
    setModal(true)
  }

  const openEdit = (p: Pond) => {
    setEditing(p)
    setForm({
      name: p.name,
      code: p.code || '',
      sort_order: String(p.sort_order ?? 0),
      is_active: p.is_active,
      notes: p.notes || '',
      pond_role: p.pond_role || 'grow_out',
      warehouse_group_id:
        p.warehouse_group_id != null ? String(p.warehouse_group_id) : '',
      pos_customer_id: p.pos_customer_id != null ? String(p.pos_customer_id) : '',
      leasing_area_decimal: p.leasing_area_decimal ?? '',
      water_area_decimal: p.water_area_decimal ?? '',
      pond_depth_ft: p.pond_depth_ft ?? '',
      lease_contract_start: p.lease_contract_start ? p.lease_contract_start.split('T')[0] : '',
      lease_contract_end: p.lease_contract_end ? p.lease_contract_end.split('T')[0] : '',
      lease_price_per_decimal_per_year: p.lease_price_per_decimal_per_year ?? '',
      lease_paid_to_landlord: p.lease_paid_to_landlord ?? '0',
    })
    setModal(true)
  }

  const save = async () => {
    const name = form.name.trim()
    if (!name) {
      toast.error('Name is required')
      return
    }
    try {
      const payload: Record<string, unknown> = {
        name,
        sort_order: parseInt(form.sort_order, 10) || 0,
        is_active: form.is_active,
        notes: form.notes.trim(),
        pond_role: form.pond_role,
        leasing_area_decimal: form.leasing_area_decimal.trim() || null,
        water_area_decimal: form.water_area_decimal.trim() || null,
        pond_depth_ft: form.pond_depth_ft.trim() || null,
        lease_contract_start: form.lease_contract_start.trim() || null,
        lease_contract_end: form.lease_contract_end.trim() || null,
        lease_price_per_decimal_per_year: form.lease_price_per_decimal_per_year.trim() || null,
        lease_paid_to_landlord: parseMoneyInput(form.lease_paid_to_landlord),
      }
      if (form.pos_customer_id.trim()) {
        const cid = parseInt(form.pos_customer_id, 10)
        if (!Number.isFinite(cid)) {
          toast.error('Invalid POS customer')
          return
        }
        payload.pos_customer_id = cid
      } else {
        payload.pos_customer_id = null
      }
      if (form.warehouse_group_id.trim()) {
        const gid = parseInt(form.warehouse_group_id, 10)
        if (!Number.isFinite(gid)) {
          toast.error('Invalid shared warehouse group')
          return
        }
        payload.warehouse_group_id = gid
      } else {
        payload.warehouse_group_id = null
      }
      if (!editing && skipAutoPosCustomer) {
        payload.skip_auto_pos_customer = true
      }
      if (editing) {
        payload.code = form.code.trim()
        await api.put(`/aquaculture/ponds/${editing.id}/`, payload)
        toast.success('Pond updated')
      } else {
        const { data } = await api.post<Pond>('/aquaculture/ponds/', payload)
        const c = data?.code?.trim()
        toast.success(c ? `Pond created (${c})` : 'Pond created')
      }
      setModal(false)
      void load()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Save failed'))
    }
  }

  const remove = async (p: Pond) => {
    if (!window.confirm(`Delete pond “${p.name}”? This cannot be undone if no dependencies block it.`)) return
    try {
      await api.delete(`/aquaculture/ponds/${p.id}/`)
      toast.success('Deleted')
      void load()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Delete failed'))
    }
  }

  const PondActions = ({ p }: { p: Pond }) => (
    <div className="flex shrink-0 gap-1">
      <Link
        href={`/aquaculture/ponds/${p.id}`}
        className="rounded p-2 text-teal-700 hover:bg-teal-50"
        aria-label={`View ${p.name}`}
        title="View pond details, growth & FCR"
      >
        <Eye className="h-4 w-4" />
      </Link>
      <button
        type="button"
        onClick={() => openEdit(p)}
        className="rounded p-2 text-slate-600 hover:bg-slate-100"
        aria-label={`Edit ${p.name}`}
      >
        <Edit2 className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => void remove(p)}
        className="rounded p-2 text-red-600 hover:bg-red-50"
        aria-label={`Delete ${p.name}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )

  return (
    <>
      <div className="flex min-h-full min-w-0 flex-col">
        <header className="sticky top-0 z-20 border-b border-slate-200/90 bg-slate-50/95 px-4 py-3 backdrop-blur-md sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1800px]">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h1 id="aq-ponds-title" className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
                    Production ponds
                  </h1>
                  {!loading && ponds.length > 0 ? (
                    <span className="rounded-full bg-slate-200/80 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                      {filteredPonds.length === ponds.length
                        ? `${pondStats.total} total · ${pondStats.active} active`
                        : `${filteredPonds.length} shown · ${pondStats.total} total`}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 max-w-3xl text-sm leading-snug text-slate-600">
                  Each pond is a reporting unit for stocking, tilapia load, landlord lease math, and (usually) a linked POS
                  customer for on-account feed and supplies.{' '}
                  <Link
                    href="/aquaculture/sales"
                    className="font-medium text-teal-800 underline decoration-teal-600/35 underline-offset-2 hover:text-teal-900"
                  >
                    Sales
                  </Link>
                  <span className="text-slate-400"> · </span>
                  <Link
                    href="/aquaculture/expenses"
                    className="font-medium text-teal-800 underline decoration-teal-600/35 underline-offset-2 hover:text-teal-900"
                  >
                    Expenses
                  </Link>
                  <span className="text-slate-400"> · </span>
                  <Link
                    href="/aquaculture/stock"
                    className="font-medium text-teal-800 underline decoration-teal-600/35 underline-offset-2 hover:text-teal-900"
                  >
                    Stock
                  </Link>
                </p>
              </div>
              <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end xl:w-auto">
                <div className="relative w-full sm:w-52 lg:w-60">
                  <Search
                    className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                    aria-hidden
                  />
                  <input
                    type="search"
                    placeholder="Search name, code, customer…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                    aria-label="Search ponds"
                  />
                </div>
                <div
                  className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm"
                  role="group"
                  aria-label="Filter by pond status"
                >
                  {(['all', 'active', 'inactive'] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setStatusFilter(key)}
                      aria-pressed={statusFilter === key}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-medium capitalize sm:text-sm ${
                        statusFilter === key ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {key}
                    </button>
                  ))}
                </div>
                <div
                  className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
                  role="group"
                  aria-label="Display layout"
                >
                  <button
                    type="button"
                    onClick={() => setViewMode('list')}
                    aria-pressed={viewMode === 'list'}
                    className={`inline-flex items-center gap-1 rounded-md px-2.5 py-2 text-sm ${
                      viewMode === 'list' ? 'bg-white font-medium text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <List className="h-4 w-4" aria-hidden />
                    <span className="hidden sm:inline">Table</span>
                    <span className="sm:hidden">Rows</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('cards')}
                    aria-pressed={viewMode === 'cards'}
                    className={`inline-flex items-center gap-1 rounded-md px-2.5 py-2 text-sm ${
                      viewMode === 'cards'
                        ? 'bg-white font-medium text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <LayoutGrid className="h-4 w-4" aria-hidden />
                    Cards
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={() => setOpeningModal(true)}
                  disabled={ponds.length === 0}
                  className="inline-flex items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-medium text-teal-900 shadow-sm hover:bg-teal-100 disabled:opacity-50"
                  title="Go-live: P&L by income/expense category, customer A/R, advanced party openings; landlords on Landlords page"
                >
                  <Landmark className="h-4 w-4" aria-hidden />
                  Go-live setup
                </button>
                <button
                  type="button"
                  onClick={openNew}
                  className="inline-flex items-center gap-1 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-700"
                >
                  <Plus className="h-4 w-4" />
                  Add pond
                </button>
              </div>
            </div>

            {!loading && ponds.length > 0 ? (
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                <div className="rounded-lg border border-slate-100 bg-white px-3 py-2.5 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Water surface Σ</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-base font-bold tabular-nums text-slate-900 sm:text-lg">
                    <Droplets className="h-4 w-4 shrink-0 text-sky-600" aria-hidden />
                    {pondStats.waterDec > 0 ? `${formatNumber(pondStats.waterDec, 2)} dec` : '—'}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Stocking &amp; density basis</p>
                </div>
                <div className="rounded-lg border border-slate-100 bg-white px-3 py-2.5 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Lease land Σ</p>
                  <p className="mt-0.5 text-base font-bold tabular-nums text-slate-900 sm:text-lg">
                    {pondStats.leaseDec > 0 ? `${formatNumber(pondStats.leaseDec, 2)} dec` : '—'}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Landlord rent basis</p>
                </div>
                <div className="rounded-lg border border-slate-100 bg-white px-3 py-2.5 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tilapia biomass Σ</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-base font-bold tabular-nums text-slate-900 sm:text-lg">
                    <Fish className="h-4 w-4 shrink-0 text-teal-600" aria-hidden />
                    {pondStats.biomassKg > 0 ? `${formatNumber(pondStats.biomassKg, 1)} kg` : '—'}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Where reported per pond</p>
                </div>
                <div className="rounded-lg border border-slate-100 bg-white px-3 py-2.5 shadow-sm">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Net lease position Σ</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-base font-bold tabular-nums text-slate-900 sm:text-lg">
                    <Wallet className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
                    {fmtMoney(pondStats.balanceDueSum)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Positive = still to pay</p>
                </div>
                <div className="col-span-2 rounded-lg border border-teal-100 bg-teal-50/60 px-3 py-2.5 shadow-sm sm:col-span-1">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-teal-900">Tip</p>
                  <p className="mt-0.5 text-xs leading-snug text-teal-950/90">
                    Use <span className="font-semibold">Cards</span> on small screens; <span className="font-semibold">Table</span> fits wide
                    monitors. Open a pond for economics, FCR, and detail charts.
                  </p>
                </div>
              </div>
            ) : null}

            <PondGoLiveFleetBanner
              fleet={goLiveFleet}
              cutoverDate={goLiveCutoverDate}
              loading={goLiveLoading}
              onOpenSetup={() => setOpeningModal(true)}
            />
          </div>
        </header>

        <div className="min-w-0 flex-1 px-4 py-4 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1800px]">
            <details className="group mb-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-slate-800 marker:content-none [&::-webkit-details-marker]:hidden">
                <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180" aria-hidden />
                <Sparkles className="h-4 w-4 shrink-0 text-amber-500" aria-hidden />
                How ponds, POS customers, and leases work together
              </summary>
              <div className="border-t border-slate-100 px-4 py-3 text-sm leading-relaxed text-slate-600">
                <ul className="list-disc space-y-2 pl-5">
                  <li>
                    <strong className="font-semibold text-slate-800">POS customer:</strong> New ponds usually get an
                    auto-created &quot;Aquaculture — …&quot; customer so you can sell feed, medicine, and supplies on account from{' '}
                    <strong className="font-medium text-slate-800">Cashier</strong> with correct inventory and GL.
                  </li>
                  <li>
                    <strong className="font-semibold text-slate-800">Two areas:</strong>{' '}
                    <em>Water surface</em> drives stocking and tilapia load; <em>leasing decimals</em> drive landlord rent when
                    you enter price per decimal per year.
                  </li>
                  <li>
                    <strong className="font-semibold text-slate-800">Non-POS costs:</strong> Leases, power, labour, and cash
                    purchases go through <Link href="/aquaculture/expenses" className="font-medium text-teal-800 underline">Aquaculture expenses</Link>.
                  </li>
                  <li>
                    <strong className="font-semibold text-slate-800">Internal issues:</strong> The expenses page optional at-cost stock issue is only for deliberate moves without ringing POS.
                  </li>
                  <li>
                    <strong className="font-semibold text-slate-800">Go-live openings:</strong>{' '}
                    <strong>Go-live setup</strong> — cutover checklist: prior P&amp;L, A/R, fish biomass, feed on hand, lease
                    A/R for on-account sales, and advanced vendor/employee/loan links.{' '}
                    <strong>Landlord rent</strong> is set only on{' '}
                    <Link href="/aquaculture/landlords" className="font-medium text-teal-800 underline">
                      Landlords
                    </Link>
                    .
                  </li>
                </ul>
              </div>
            </details>

            {!loading && pondsMissingPosCustomer.length > 0 ? (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <p className="font-medium">
                  {pondsMissingPosCustomer.length} pond{pondsMissingPosCustomer.length === 1 ? '' : 's'}{' '}
                  {pondsMissingPosCustomer.length === 1 ? 'has' : 'have'} no POS customer
                </p>
                <p className="mt-1 text-xs leading-relaxed text-amber-900/90">
                  On-account feed and supplies from your shop station (e.g. Premium Agro) need an
                  &quot;Aquaculture — [pond name]&quot; customer in Cashier. Create the missing customers now — they
                  default to your shop-only station when one exists.
                </p>
                <button
                  type="button"
                  onClick={() => void provisionMissingPosCustomers()}
                  disabled={provisioningCustomers}
                  className="mt-2 rounded-lg bg-amber-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-900 disabled:opacity-60"
                >
                  {provisioningCustomers ? 'Creating…' : 'Create missing POS customers'}
                </button>
              </div>
            ) : null}

            {loading ? (
              <div className="flex justify-center py-16" aria-busy="true">
                <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
              </div>
            ) : ponds.length === 0 ? (
              <div
                className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm"
                aria-labelledby="aq-ponds-title"
              >
                <p className="text-sm font-medium text-slate-700">No ponds yet</p>
                <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                  Create your first production unit to unlock aquaculture expenses, sales, sampling, and pond-level
                  reporting.
                </p>
                <button
                  type="button"
                  onClick={openNew}
                  className="mt-6 inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-teal-700"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  Add your first pond
                </button>
              </div>
            ) : filteredPonds.length === 0 ? (
              <div
                className="rounded-xl border border-amber-200/80 bg-amber-50/80 p-8 text-center shadow-sm"
                aria-live="polite"
              >
                <p className="text-sm font-semibold text-amber-950">No ponds match this view</p>
                <p className="mx-auto mt-2 max-w-md text-sm text-amber-900/90">
                  Try another search keyword, set status to &quot;all&quot;, or clear the search box.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('')
                    setStatusFilter('all')
                  }}
                  className="mt-4 rounded-lg border border-amber-300/80 bg-white px-4 py-2 text-sm font-medium text-amber-950 shadow-sm hover:bg-amber-50"
                >
                  Clear search &amp; filters
                </button>
              </div>
            ) : viewMode === 'list' ? (
              <div
                className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                aria-labelledby="aq-ponds-title"
              >
                <div className="overflow-x-auto">
                  <table className="min-w-[860px] w-full text-left text-sm">
                    <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/95 text-xs font-semibold uppercase tracking-wide text-slate-500 backdrop-blur-sm">
                      <tr>
                        <th className="px-3 py-3 lg:px-4">Pond</th>
                        <th className="px-3 py-3 lg:px-4">Role &amp; status</th>
                        <th className="px-3 py-3 lg:px-4">Tilapia load</th>
                        <th className="min-w-[9rem] px-3 py-3 lg:px-4">POS customer</th>
                        <th className="px-3 py-3 lg:px-4">Areas &amp; volume</th>
                        <th className="min-w-[11rem] px-3 py-3 lg:px-4">Lease</th>
                        <th className="px-3 py-3 text-right lg:px-4">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredPonds.map((p) => (
                        <tr key={p.id} className="align-top text-slate-800 transition-colors hover:bg-teal-50/30">
                          <td className="px-3 py-3 lg:px-4">
                            <Link
                              href={`/aquaculture/ponds/${p.id}`}
                              className="group block min-w-[7.5rem] max-w-[16rem]"
                              title="Open pond dashboard"
                            >
                              <span className="font-semibold text-teal-900 underline decoration-teal-500/0 underline-offset-2 transition group-hover:decoration-teal-600/70">
                                {p.name}
                              </span>
                              <span className="mt-0.5 block text-xs text-slate-500">
                                {p.code ? `${p.code} · ` : ''}Order {p.sort_order}
                              </span>
                              {p.notes?.trim() ? (
                                <p className="mt-1 line-clamp-2 text-xs text-slate-500">{p.notes.trim()}</p>
                              ) : null}
                              {goLiveByPondId.has(p.id) ? (
                                <div className="mt-1.5">
                                  <PondGoLiveReadinessBadge
                                    readinessPercent={goLiveByPondId.get(p.id)!.readinessPercent}
                                    ready={goLiveByPondId.get(p.id)!.ready}
                                  />
                                </div>
                              ) : null}
                            </Link>
                          </td>
                          <td className="px-3 py-3 lg:px-4">
                            <div className="flex flex-col gap-1.5">
                              <span className="w-fit rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-800">
                                {p.pond_role_label || (p.pond_role === 'nursing' ? 'Nursing' : 'Grow-out')}
                              </span>
                              <span
                                className={`w-fit rounded-full px-2 py-0.5 text-xs font-medium ${
                                  p.is_active ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {p.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </div>
                          </td>
                          <td className="max-w-[10rem] px-3 py-3 lg:max-w-none lg:px-4">
                            <PondTilapiaLoadCell p={p} />
                          </td>
                          <td className="max-w-[11rem] px-3 py-3 text-xs text-slate-600 lg:px-4">
                            {p.pos_customer_id ? (
                              <div className="space-y-1.5">
                                <span className="flex flex-wrap items-center gap-1.5">
                                  <span
                                    className="line-clamp-2 font-medium text-teal-900"
                                    title={p.pos_customer_display?.trim() || `Customer #${p.pos_customer_id}`}
                                  >
                                    {p.pos_customer_display?.trim() || `Customer #${p.pos_customer_id}`}
                                  </span>
                                  {p.pos_customer_auto_managed ? (
                                    <span className="shrink-0 rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-900">
                                      Auto
                                    </span>
                                  ) : null}
                                </span>
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                  <Link
                                    href={`/cashier?customer=${p.pos_customer_id}`}
                                    className="inline-flex items-center gap-0.5 font-medium text-teal-800 underline decoration-teal-800/40 underline-offset-2 hover:decoration-teal-800"
                                    title="Cashier with this customer"
                                  >
                                    <Store className="h-3 w-3 shrink-0" aria-hidden />
                                    POS
                                  </Link>
                                  <span className="text-slate-300" aria-hidden>
                                    ·
                                  </span>
                                  <Link
                                    href={`/customers/${p.pos_customer_id}/ledger`}
                                    className="inline-flex items-center gap-0.5 font-medium text-slate-700 underline decoration-slate-400 underline-offset-2 hover:text-slate-900"
                                    title="A/R ledger"
                                  >
                                    <BookOpen className="h-3 w-3 shrink-0" aria-hidden />
                                    Ledger
                                  </Link>
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="max-w-[13rem] px-3 py-3 text-xs leading-snug text-slate-700 lg:px-4">
                            <span className="break-words">{pondAreasCell(p)}</span>
                          </td>
                          <td className="min-w-[11rem] px-3 py-3 lg:px-4">
                            <PondLeaseCell p={p} />
                          </td>
                          <td className="px-3 py-3 text-right lg:px-4">
                            <PondActions p={p} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <ul
                className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
                aria-labelledby="aq-ponds-title"
              >
                {filteredPonds.map((p) => {
                  const bal =
                    p.lease_balance_due !== null && p.lease_balance_due !== undefined
                      ? Number(p.lease_balance_due)
                      : null
                  return (
                    <li
                      key={p.id}
                      className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm ring-1 ring-slate-900/[0.02] transition-shadow hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link
                            href={`/aquaculture/ponds/${p.id}`}
                            className="truncate font-semibold text-teal-900 underline decoration-teal-600/30 underline-offset-2 hover:decoration-teal-700/60"
                          >
                            {p.name}
                          </Link>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {p.code ? `Code ${p.code} · ` : ''}Sort {p.sort_order}
                          </p>
                          <p className="mt-1 text-[11px] font-medium text-slate-600">
                            {(p.pond_role_label || '').trim() ||
                              (p.pond_role === 'nursing'
                                ? 'Nursing / nursery'
                                : p.pond_role === 'broodstock'
                                  ? 'Broodstock'
                                  : 'Grow-out')}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              p.is_active ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            {p.is_active ? 'Active' : 'Inactive'}
                          </span>
                          {goLiveByPondId.has(p.id) ? (
                            <PondGoLiveReadinessBadge
                              readinessPercent={goLiveByPondId.get(p.id)!.readinessPercent}
                              ready={goLiveByPondId.get(p.id)!.ready}
                            />
                          ) : null}
                        </div>
                      </div>

                      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                        <div className="col-span-2">
                          <dt className="text-slate-500">Tilapia load</dt>
                          <dd className="mt-0.5 font-medium text-slate-800">
                            <PondTilapiaLoadCell p={p} />
                          </dd>
                        </div>
                        <div className="col-span-2 sm:col-span-1">
                          <dt className="text-slate-500">Lease / water / depth</dt>
                          <dd className="font-medium text-slate-800">{pondAreasCell(p)}</dd>
                        </div>
                        <div className="col-span-2 sm:col-span-1">
                          <dt className="text-slate-500">Price / dec / yr</dt>
                          <dd className="font-medium tabular-nums text-slate-800">
                            {p.lease_price_per_decimal_per_year
                              ? fmtMoney(Number(p.lease_price_per_decimal_per_year))
                              : '—'}
                          </dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="text-slate-500">General POS customer</dt>
                          <dd className="font-medium text-slate-800">
                            {p.pos_customer_id ? (
                              <span className="block space-y-1">
                                <span className="flex flex-wrap items-center gap-2 text-teal-900">
                                  <span>{p.pos_customer_display?.trim() || `Customer #${p.pos_customer_id}`}</span>
                                  {p.pos_customer_auto_managed ? (
                                    <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-teal-900">
                                      Auto
                                    </span>
                                  ) : null}
                                </span>
                                <span className="flex flex-wrap items-center gap-x-2 text-xs font-normal text-slate-600">
                                  <Link
                                    href={`/cashier?customer=${p.pos_customer_id}`}
                                    className="inline-flex items-center gap-0.5 text-teal-800 underline"
                                  >
                                    <Store className="h-3 w-3" aria-hidden />
                                    Open POS
                                  </Link>
                                  <span className="text-slate-300">·</span>
                                  <Link
                                    href={`/customers/${p.pos_customer_id}/ledger`}
                                    className="inline-flex items-center gap-0.5 underline"
                                  >
                                    <BookOpen className="h-3 w-3" aria-hidden />
                                    A/R ledger
                                  </Link>
                                </span>
                              </span>
                            ) : (
                              '—'
                            )}
                          </dd>
                        </div>
                        <div className="col-span-2">
                          <dt className="text-slate-500">Lease period</dt>
                          <dd className="font-medium text-slate-800">
                            {p.lease_contract_start || p.lease_contract_end
                              ? `${formatDateOnly(p.lease_contract_start)} → ${formatDateOnly(p.lease_contract_end)}`
                              : '—'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Annual lease</dt>
                          <dd className="font-medium tabular-nums text-slate-800">
                            {fmtMoney(p.lease_annual_amount ? Number(p.lease_annual_amount) : null)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Contract total</dt>
                          <dd className="font-medium tabular-nums text-slate-800">
                            {fmtMoney(p.lease_contract_total ? Number(p.lease_contract_total) : null)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Paid to landlord</dt>
                          <dd className="font-medium tabular-nums text-slate-800">
                            {fmtMoney(Number(p.lease_paid_to_landlord))}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Remaining</dt>
                          <dd className="font-medium text-slate-800">
                            {p.lease_remaining_years !== null && p.lease_remaining_months !== null
                              ? `${p.lease_remaining_years}y ${p.lease_remaining_months}m`
                              : '—'}
                          </dd>
                        </div>
                        <div className="col-span-2 rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5">
                          <dt className="text-slate-500">Balance</dt>
                          <dd className={`text-sm font-semibold tabular-nums ${balanceTone(p.lease_balance_due)}`}>
                            {bal === null || Number.isNaN(bal)
                              ? '—'
                              : bal > 0
                                ? `${fmtMoney(bal)} due`
                                : bal < 0
                                  ? `${fmtMoney(bal)} prepaid`
                                  : 'Settled'}
                          </dd>
                        </div>
                      </dl>

                      {p.notes?.trim() ? (
                        <p className="mt-2 line-clamp-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
                          {p.notes.trim()}
                        </p>
                      ) : null}

                      <div className="mt-auto flex justify-end border-t border-slate-100 pt-3">
                        <PondActions p={p} />
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
      <PondOpeningBalancesModal
        open={openingModal}
        currency={currency}
        onClose={() => setOpeningModal(false)}
        onSaved={() => void load()}
      />
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">{editing ? 'Edit pond' : 'New pond'}</h2>
            <div className="mt-4 space-y-3">
              <label className="block text-sm font-medium text-slate-700">
                Name
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                General POS customer (on-account sales)
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={form.pos_customer_id}
                  onChange={(e) => setForm((f) => ({ ...f, pos_customer_id: e.target.value }))}
                  disabled={customersLoading && customers.length === 0}
                >
                  <option value="">— None (internal shop issue only) —</option>
                  {customers.map((c) => {
                    const inactive = c.is_active === false
                    const locked = editing && String(c.id) === form.pos_customer_id.trim()
                    return (
                      <option key={c.id} value={c.id} disabled={inactive && !locked}>
                        {customerPickLabel(c, ponds)}
                        {inactive ? ' (inactive)' : ''}
                      </option>
                    )
                  })}
                </select>
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  New ponds: a POS customer is created automatically (name &quot;Aquaculture — [pond name]&quot;) so
                  they appear in Cashier. You can pick a different customer instead; that turns off automatic sync.
                  Renaming the pond or toggling inactive updates an auto-managed customer. Leave the list on
                  &quot;None&quot; only if you pass{' '}
                  <code className="rounded bg-slate-100 px-1 text-[11px]">skip_auto_pos_customer</code> on create via
                  API, or to clear an existing link.
                </span>
                {editing?.pos_customer_auto_managed ? (
                  <p className="mt-2 text-xs text-teal-900">
                    This customer is auto-managed: display name and active flag follow this pond until you choose
                    another customer.
                  </p>
                ) : null}
                {!editing ? (
                  <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      className="mt-0.5 rounded border-slate-300"
                      checked={skipAutoPosCustomer}
                      onChange={(e) => {
                        const v = e.target.checked
                        setSkipAutoPosCustomer(v)
                        if (v) setForm((f) => ({ ...f, pos_customer_id: '' }))
                      }}
                    />
                    <span>
                      Do not create a POS customer for this pond (advanced; pond will not appear in Cashier until you
                      link one manually).
                    </span>
                  </label>
                ) : null}
                {form.pos_customer_id.trim() ? (
                  <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
                    <Link
                      href={`/cashier?customer=${encodeURIComponent(form.pos_customer_id.trim())}`}
                      className="inline-flex items-center gap-1 font-medium text-teal-800 underline"
                    >
                      <Store className="h-3.5 w-3.5" aria-hidden />
                      Open cashier for this customer
                    </Link>
                    <span className="text-slate-300">·</span>
                    <Link
                      href={`/customers/${encodeURIComponent(form.pos_customer_id.trim())}/ledger`}
                      className="inline-flex items-center gap-1 font-medium text-slate-700 underline"
                    >
                      <BookOpen className="h-3.5 w-3.5" aria-hidden />
                      A/R ledger
                    </Link>
                  </p>
                ) : null}
              </label>
              {editing ? (
                <label className="block text-sm font-medium text-slate-700">
                  Code
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono"
                    value={form.code}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                    placeholder="e.g. P01"
                  />
                </label>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <p className="text-sm font-medium text-slate-700">Pond code (assigned automatically)</p>
                  <p className="mt-1 font-mono text-base font-semibold text-slate-900">{form.code}</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Uses the lowest free P-number (P01, P02, …). If a pond is deleted, its code is freed; the next
                    new pond reuses the smallest gap (e.g. only P02 on file → new pond gets P01).
                  </p>
                </div>
              )}
              <label className="block text-sm font-medium text-slate-700">
                Sort order
                <input
                  type="number"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.sort_order}
                  onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                />
                Active
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Pond role
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={form.pond_role}
                  onChange={(e) => setForm((f) => ({ ...f, pond_role: e.target.value }))}
                >
                  {POND_ROLE_OPTIONS.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Used for filters and nursing → grow-out transfers (management only; does not post GL by itself).
                </span>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Shared warehouse group
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={form.warehouse_group_id}
                  onChange={(e) => setForm((f) => ({ ...f, warehouse_group_id: e.target.value }))}
                >
                  <option value="">None — private pond warehouse</option>
                  {warehouseGroups.map((g) => (
                    <option key={g.id} value={String(g.id)}>
                      {g.name}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Ponds on the same physical feed/medicine shed (e.g. Ashari-1 and Ashari-2). Create groups under{' '}
                  <strong>Stock → Feed &amp; supplies</strong>. Reallocate with Move between ponds.
                </span>
              </label>

              <div className="border-t border-slate-200 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aquaculture (production)</p>
              </div>
              <label className="block text-sm font-medium text-slate-700">
                Water area (decimal)
                <input
                  inputMode="decimal"
                  step="0.01"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="e.g. 2.40"
                  value={form.water_area_decimal}
                  onChange={(e) => setForm((f) => ({ ...f, water_area_decimal: e.target.value }))}
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Effective water surface for stocking, density (fish per decimal), and comparisons with extension
                  guides (e.g. tilapia); can differ from leased land if banks or unused strips are not fully watered.
                </span>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Average depth (feet)
                <input
                  inputMode="decimal"
                  step="0.01"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="e.g. 5.50"
                  value={form.pond_depth_ft}
                  onChange={(e) => setForm((f) => ({ ...f, pond_depth_ft: e.target.value }))}
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Used with water area (decimals): 435.6 sq ft per decimal × depth → water volume in cubic feet for
                  stocking density hints on the Stock page.
                </span>
              </label>

              {editing ? (
                <div className="rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50 to-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-teal-950">Go-live opening balances</h3>
                      <p className="mt-1 text-xs leading-relaxed text-slate-700">
                        Prior P&amp;L by income type and expense category, customer A/R (unpaid on-account sales),
                        vendors, employees, and fish biomass are <strong>not</strong> entered on this pond form. Landlord
                        rent ledger openings are on{' '}
                        <Link href="/aquaculture/landlords" className="font-medium text-teal-800 underline">
                          Aquaculture → Landlords
                        </Link>
                        .
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setModal(false)
                        setEditing(null)
                        setOpeningModal(true)
                      }}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-teal-800"
                    >
                      <Wallet className="h-4 w-4" aria-hidden />
                      Open go-live setup
                    </button>
                  </div>
                </div>
              ) : (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600">
                  After you save the new pond, use <strong>Go-live setup</strong> on the toolbar above for prior
                  P&amp;L, customer A/R, and other go-live amounts.
                </p>
              )}

              <div className="border-t border-slate-200 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lease contract (rent math)</p>
                <p className="mt-1 text-xs text-slate-500">
                  Figures below adjust the lease balance due on this pond. They are separate from landlord ledger
                  openings and from P&amp;L / A/R go-live balances.
                </p>
              </div>
              <label className="block text-sm font-medium text-slate-700">
                Leasing area (decimal)
                <input
                  inputMode="decimal"
                  step="0.01"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="e.g. 2.50"
                  value={form.leasing_area_decimal}
                  onChange={(e) => setForm((f) => ({ ...f, leasing_area_decimal: e.target.value }))}
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Land area your lease is priced on — used only with &quot;price per decimal per year&quot; below for rent.
                </span>
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700">
                  Contract start
                  <input
                    type="date"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={form.lease_contract_start}
                    onChange={(e) => setForm((f) => ({ ...f, lease_contract_start: e.target.value }))}
                  />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Contract end
                  <input
                    type="date"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={form.lease_contract_end}
                    onChange={(e) => setForm((f) => ({ ...f, lease_contract_end: e.target.value }))}
                  />
                </label>
              </div>
              <label className="block text-sm font-medium text-slate-700">
                Lease price per decimal per year
                <input
                  inputMode="decimal"
                  step="0.01"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="e.g. 18500.00"
                  value={form.lease_price_per_decimal_per_year}
                  onChange={(e) => setForm((f) => ({ ...f, lease_price_per_decimal_per_year: e.target.value }))}
                />
              </label>

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
                <p className="font-medium text-slate-700">Calculated (from entries above)</p>
                <ul className="mt-2 space-y-1 text-slate-600">
                  <li>
                    Annual lease (leasing area × price):{' '}
                    <span className="font-medium text-slate-900">{fmtMoney(preview.annual)}</span>
                  </li>
                  <li>
                    Contract length (years, rounded):{' '}
                    <span className="font-medium text-slate-900">
                      {preview.contractYearsRounded !== null ? `${preview.contractYearsRounded} yr` : '—'}
                    </span>
                  </li>
                  <li>
                    Total for contract term:{' '}
                    <span className="font-medium text-slate-900">{fmtMoney(preview.total)}</span>
                  </li>
                  <li>
                    Remaining on lease:{' '}
                    <span className="font-medium text-slate-900">
                      {preview.remY !== null && preview.remM !== null
                        ? `${preview.remY} yr, ${preview.remM} mo (from today or contract start)`
                        : '—'}
                    </span>
                  </li>
                </ul>
              </div>

              <label className="block text-sm font-medium text-slate-700">
                Already paid on lease (before go-live)
                <input
                  inputMode="decimal"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  placeholder="0"
                  value={form.lease_paid_to_landlord}
                  onChange={(e) => setForm((f) => ({ ...f, lease_paid_to_landlord: e.target.value }))}
                />
                <span className="mt-1 block text-xs font-normal text-slate-500">
                  Total rent you had already paid on this lease contract before recording payments in{' '}
                  <Link href="/aquaculture/landlords" className="font-medium text-teal-800 underline">
                    Landlords
                  </Link>
                  . This reduces &quot;balance after landlord payments&quot; below — it is <strong>not</strong> the same
                  as income, expense, or customer opening balances (use the button above or{' '}
                  <strong>Go-live setup</strong> on the ponds toolbar).
                </span>
              </label>
              <div
                className={`rounded-lg border p-3 text-sm ${
                  preview.balance === null
                    ? 'border-slate-200 bg-slate-50 text-slate-600'
                    : preview.balance > 0
                      ? 'border-amber-200 bg-amber-50 text-amber-950'
                      : preview.balance < 0
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
                        : 'border-slate-200 bg-slate-50 text-slate-800'
                }`}
              >
                <p className="font-medium">Balance after landlord payments</p>
                <p className="mt-1 text-base font-semibold">
                  {preview.balance === null
                    ? 'Enter contract dates, leasing area, and price to compute.'
                    : preview.balance > 0
                      ? `${fmtMoney(preview.balance)} still to pay`
                      : preview.balance < 0
                        ? `${fmtMoney(preview.balance)} (prepaid / advance to landlord)`
                        : 'Settled for computed contract total'}
                </p>
              </div>

              <label className="block text-sm font-medium text-slate-700">
                Notes
                <textarea
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setModal(false)}
                className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
