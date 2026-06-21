'use client'

import type { ReactNode } from 'react'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { usePageMeta } from '@/hooks/usePageMeta'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'
import { useT } from '@/lib/i18n'
import { inventoryT } from '@/lib/moduleI18n/inventory'
import type { AppLanguage } from '@/lib/i18n'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import Modal from '@/components/ui/Modal'
import {
  ArrowRight,
  ArrowRightLeft,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  FileEdit,
  Info,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sprout,
  Trash2,
  Eye,
  Package,
  AlertCircle,
  Undo2,
} from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { isOffsetPagedPayload, REFERENCE_FETCH_LIMIT } from '@/lib/pagination'
import { CatalogItemCombobox } from '@/components/reference/CatalogItemCombobox'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatDateOnly } from '@/utils/date'
import { formatNumber, getCurrencySymbol } from '@/utils/currency'

const inputClassName =
  'w-full min-h-10 rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const selectClassName = inputClassName
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow hover:opacity-90 disabled:opacity-50'
const btnSecondary =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-input bg-background px-4 py-2.5 text-sm font-medium hover:bg-muted/60 disabled:opacity-50'
const btnDanger =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-sm text-destructive hover:bg-destructive/20'
/** Compact icon-only control for transfer row actions (tooltips via title + aria-label). */
const btnRowIcon =
  'inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-sm disabled:opacity-50'
const btnRowIconPrimary = btnRowIcon + ' bg-primary text-primary-foreground shadow hover:opacity-90'
const btnRowIconMuted = btnRowIcon + ' border border-input bg-background hover:bg-muted/60'
const btnRowIconDanger = btnRowIcon + ' border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20'
const btnRowIconWarning =
  btnRowIcon +
  ' border border-amber-200/90 bg-amber-50/80 text-amber-950 hover:bg-amber-100/90 dark:border-amber-800/50 dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-950/45'

type Station = {
  id: number
  station_name: string
  station_number?: string
  is_active?: boolean
  default_aquaculture_pond_id?: number | null
  default_aquaculture_pond_name?: string
  default_aquaculture_pond_sort_order?: number | null
}

type ItemTypeFilter = 'ALL' | 'INVENTORY' | 'NON_INVENTORY' | 'SERVICE'

type CatalogItem = {
  id: number
  name: string
  item_number?: string
  description?: string
  item_type?: string
  pos_category?: string
  is_active?: boolean
}

function normalizeCatalogItemType(raw: string | undefined): string {
  return (raw || '').trim().toLowerCase().replace(/-/g, '_')
}

function catalogItemMatchesTypeFilter(item: CatalogItem, filter: ItemTypeFilter): boolean {
  if (filter === 'ALL') return true
  const t = normalizeCatalogItemType(item.item_type)
  if (filter === 'INVENTORY') return t === 'inventory'
  if (filter === 'NON_INVENTORY') return t === 'non_inventory'
  if (filter === 'SERVICE') return t === 'service'
  return true
}

function formatCatalogItemTypeLabel(raw: string | undefined): string {
  const t = normalizeCatalogItemType(raw)
  if (!t) return ''
  return t.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

/** Same primary label as Products & Services list rows (name + SKU). */
function formatCatalogItemLabel(item: CatalogItem): string {
  const sku = (item.item_number || '').trim()
  return sku ? `${item.name} (${sku})` : item.name
}

type TransferLineRow = { item_id: number; quantity: string }

type AvailabilityResponse =
  | {
      item_id: number
      name: string
      tracks_per_station: true
      unit: string
      total_on_hand: string
      stations: { station_id: number; station_name: string; station_number: string; quantity: string }[]
      /** Pond-side warehouse (ItemPondStock); feeding apply consumes here, not from station bins. */
      pond_warehouses?: { pond_id: number; pond_name: string; quantity: string }[]
    }
  | {
      item_id: number
      name: string
      tracks_per_station: false
      message?: string
      stations: unknown[]
    }

type ItemAvailState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: AvailabilityResponse }
  | { status: 'error'; message: string }

type InventoryMoveLine = {
  id?: number
  item_id: number
  item_name: string
  quantity: string
  unit_cost?: string | null
  line_value?: string
}

type TransferRecord = {
  id: number
  transfer_number: string
  transfer_date: string
  status: string
  memo?: string
  from_station_id: number
  to_station_id: number
  from_station_name: string
  to_station_name: string
  posted_at?: string | null
  /** Present when status is posted — automatic inter-station transfer journal id. */
  auto_journal_entry_number?: string | null
  total_value?: string
  lines: InventoryMoveLine[]
}

type PondReceiptRecord = {
  id: number
  movement_type?: 'shop_to_pond' | 'pond_to_shop'
  receipt_number?: string
  return_number?: string
  document_number?: string
  created_at: string | null
  from_station_id?: number | null
  from_station_name?: string
  pond_id: number
  pond_name: string
  to_station_id?: number | null
  to_station_name?: string
  memo?: string
  total_value?: string
  lines: InventoryMoveLine[]
}

function pondMovementDocNumber(r: PondReceiptRecord): string {
  if (r.document_number) return r.document_number
  if (r.movement_type === 'pond_to_shop') return r.return_number || `PWRT-${r.id}`
  return r.receipt_number || `PWR-${r.id}`
}

function pondMovementIsReturn(r: PondReceiptRecord): boolean {
  return r.movement_type === 'pond_to_shop'
}

function formatInventoryValue(amount: string | number | null | undefined, currencySymbol: string): string {
  return `${currencySymbol}${formatNumber(Number(amount || 0), 2)}`
}

function parseQtyInput(raw: string): number {
  const n = parseFloat(String(raw).replace(/,/g, '').trim())
  return Number.isFinite(n) ? n : NaN
}

function qtyAtSourceStation(
  data: AvailabilityResponse,
  fromStationId: number
): { qtyNum: number; unit: string } {
  if (!data.tracks_per_station) return { qtyNum: 0, unit: '' }
  const row = data.stations.find(s => s.station_id === fromStationId)
  const q = parseFloat(String(row?.quantity ?? '0').replace(/,/g, ''))
  return {
    qtyNum: Number.isFinite(q) ? q : 0,
    unit: (data.unit || 'units').trim() || 'units',
  }
}

function qtyAtSourcePond(
  data: AvailabilityResponse,
  pondId: number
): { qtyNum: number; unit: string } {
  if (!data.tracks_per_station) return { qtyNum: 0, unit: '' }
  const row = data.pond_warehouses?.find(p => p.pond_id === pondId)
  const q = parseFloat(String(row?.quantity ?? '0').replace(/,/g, ''))
  return {
    qtyNum: Number.isFinite(q) ? q : 0,
    unit: (data.unit || 'units').trim() || 'units',
  }
}

type TransferEndpoint = { kind: 'station'; id: number } | { kind: 'pond'; id: number }

function transferEndpointKey(e: TransferEndpoint | null): string {
  if (!e) return ''
  return e.kind === 'station' ? `s:${e.id}` : `p:${e.id}`
}

function parseTransferEndpointKey(raw: string): TransferEndpoint | null {
  if (!raw) return null
  const m = /^([sp]):(\d+)$/.exec(raw.trim())
  if (!m) return null
  const id = parseInt(m[2], 10)
  if (!Number.isFinite(id) || id <= 0) return null
  return m[1] === 's' ? { kind: 'station', id } : { kind: 'pond', id }
}

function transferEndpointsEqual(a: TransferEndpoint | null, b: TransferEndpoint | null): boolean {
  if (!a || !b) return false
  return a.kind === b.kind && a.id === b.id
}

type TransferRouteKind = 'station-station' | 'station-pond' | 'pond-pond' | 'pond-station' | 'none'

function classifyTransferRoute(
  from: TransferEndpoint | null,
  to: TransferEndpoint | null,
): TransferRouteKind {
  if (!from || !to) return 'none'
  if (from.kind === 'station' && to.kind === 'station') return 'station-station'
  if (from.kind === 'station' && to.kind === 'pond') return 'station-pond'
  if (from.kind === 'pond' && to.kind === 'pond') return 'pond-pond'
  if (from.kind === 'pond' && to.kind === 'station') return 'pond-station'
  return 'none'
}

function qtyAtSourceEndpoint(
  data: AvailabilityResponse,
  from: TransferEndpoint,
): { qtyNum: number; unit: string } {
  return from.kind === 'station'
    ? qtyAtSourceStation(data, from.id)
    : qtyAtSourcePond(data, from.id)
}

function qtyAtDestinationEndpoint(
  data: AvailabilityResponse,
  to: TransferEndpoint,
): { qtyNum: number; unit: string } {
  return to.kind === 'station' ? qtyAtSourceStation(data, to.id) : qtyAtSourcePond(data, to.id)
}

function sumQtySameItemOtherLines(rows: TransferLineRow[], itemId: number, exceptIndex: number): number {
  let sum = 0
  rows.forEach((r, j) => {
    if (j === exceptIndex || r.item_id !== itemId) return
    const q = parseQtyInput(r.quantity)
    if (q > 0) sum += q
  })
  return sum
}

function transferSourceCreditQty(
  itemId: number,
  from: TransferEndpoint | null,
  original: TransferRecord | null,
): number {
  if (!original || !from || from.kind !== 'station') return 0
  if (original.from_station_id !== from.id) return 0
  let sum = 0
  for (const ln of original.lines || []) {
    if (ln.item_id === itemId) sum += parseQtyInput(String(ln.quantity))
  }
  return sum
}

function pondReceiptSourceCreditQty(
  itemId: number,
  from: TransferEndpoint | null,
  original: PondReceiptRecord | null,
): number {
  if (!original || !from || from.kind !== 'station') return 0
  if (original.from_station_id !== from.id) return 0
  let sum = 0
  for (const ln of original.lines || []) {
    if (ln.item_id === itemId) sum += parseQtyInput(String(ln.quantity))
  }
  return sum
}

function isStationActive(s: Station): boolean {
  return s.is_active !== false
}

/** Label for transfer routes: pond name first when a site is the pond’s shop warehouse. */
function formatStationTransferLabel(s: Station): string {
  const pond = (s.default_aquaculture_pond_name || '').trim()
  const nm = (s.station_name || '').trim() || 'Station'
  const num = s.station_number ? ` (${s.station_number})` : ''
  if (!pond) return `${nm}${num}`
  const same = pond.localeCompare(nm, undefined, { sensitivity: 'accent' }) === 0
  if (same) return `${pond}${num}`
  return `${pond} — ${nm}${num}`
}

/** Site lists for transfer form: pond-linked warehouses first, then other sites (same order in From and To). */
function compareReceivingStationsByPond(a: Station, b: Station): number {
  const aLinked = (a.default_aquaculture_pond_id ?? 0) > 0
  const bLinked = (b.default_aquaculture_pond_id ?? 0) > 0
  if (aLinked && !bLinked) return -1
  if (!aLinked && bLinked) return 1
  if (aLinked && bLinked) {
    const ao = a.default_aquaculture_pond_sort_order ?? 0
    const bo = b.default_aquaculture_pond_sort_order ?? 0
    if (ao !== bo) return ao - bo
    const c = (a.default_aquaculture_pond_name || '').localeCompare(
      b.default_aquaculture_pond_name || '',
      undefined,
      { sensitivity: 'base' },
    )
    if (c !== 0) return c
  }
  return a.id - b.id
}

type PondListItem = { id: number; name: string; sort_order: number; is_active: boolean }

function comparePondsForTransfer(a: PondListItem, b: PondListItem): number {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
  return a.id - b.id
}

function renderTransferEndpointOptions(
  stations: Station[],
  ponds: PondListItem[],
  aquacultureEnabled: boolean,
  other: TransferEndpoint | null,
  userHomeStation: { id: number; name: string } | null,
  side: 'from' | 'to',
  lang: AppLanguage,
): ReactNode {
  const stationNodes = stations.map(s => {
    const endpoint: TransferEndpoint = { kind: 'station', id: s.id }
    const sameAsOther = transferEndpointsEqual(endpoint, other)
    const homeLocked = side === 'from' && userHomeStation != null && s.id !== userHomeStation.id
    return (
      <option
        key={`s-${s.id}`}
        value={transferEndpointKey(endpoint)}
        disabled={sameAsOther || homeLocked}
      >
        {formatStationTransferLabel(s)}
      </option>
    )
  })
  const pondNodes =
    aquacultureEnabled && ponds.length
      ? ponds.map(p => {
          const endpoint: TransferEndpoint = { kind: 'pond', id: p.id }
          const sameAsOther = transferEndpointsEqual(endpoint, other)
          const homeLocked = side === 'from' && userHomeStation != null
          return (
            <option
              key={`p-${p.id}`}
              value={transferEndpointKey(endpoint)}
              disabled={sameAsOther || homeLocked}
            >
              {p.name}{inventoryT('pondWarehouseSuffix', lang)}
            </option>
          )
        })
      : null

  return (
    <>
      {stations.length ? <optgroup label={inventoryT('sitesOptgroup', lang)}>{stationNodes}</optgroup> : null}
      {pondNodes ? <optgroup label={inventoryT('pondWarehousesOptgroup', lang)}>{pondNodes}</optgroup> : null}
    </>
  )
}

function interStationTransferImpactSummary(t: TransferRecord, lang: AppLanguage): string {
  if (t.status === 'draft') {
    return inventoryT('impactDraft', lang)
  }
  const je = t.auto_journal_entry_number?.trim() || `AUTO-ISTR-${t.id}`
  return inventoryT('impactPosted', lang, { je })
}

function pondWarehouseReceiptImpactSummary(lang: AppLanguage): string {
  return inventoryT('impactPondReceipt', lang)
}

function pondWarehouseReturnImpactSummary(lang: AppLanguage): string {
  return inventoryT('impactPondReturn', lang)
}

type ConfirmAction =
  | { kind: 'post'; id: number; label: string }
  | { kind: 'delete'; id: number; label: string }
  | { kind: 'unpost'; id: number; label: string }
  | { kind: 'reverse'; id: number; label: string; movementType?: 'shop_to_pond' | 'pond_to_shop' }

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = 'default',
}: {
  label: string
  value: string | number
  hint?: string
  icon: typeof Package
  accent?: 'default' | 'amber' | 'emerald' | 'teal'
}) {
  const accentClasses = {
    default: 'border-border/80 bg-card from-muted/30 to-card ring-border/60',
    amber: 'border-amber-200/80 bg-gradient-to-br from-amber-50/90 to-card ring-amber-500/10 dark:border-amber-900/40 dark:from-amber-950/25',
    emerald:
      'border-emerald-200/80 bg-gradient-to-br from-emerald-50/90 to-card ring-emerald-500/10 dark:border-emerald-900/40 dark:from-emerald-950/25',
    teal: 'border-teal-200/80 bg-gradient-to-br from-teal-50/90 to-card ring-teal-500/10 dark:border-teal-900/40 dark:from-teal-950/25',
  }[accent]

  return (
    <div
      className={`rounded-xl border bg-gradient-to-br p-4 shadow-sm ring-1 ${accentClasses}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold tabular-nums tracking-tight text-foreground">{value}</p>
          {hint ? <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background/80 shadow-sm ring-1 ring-border/60">
          <Icon className="h-5 w-5 text-muted-foreground" aria-hidden />
        </div>
      </div>
    </div>
  )
}

function InventoryContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()
  const pageMeta = usePageMeta()
  const { language } = useCompanyLocale()
  const { t } = useT()

  const tabParam = (searchParams.get('tab') || 'transfers').toLowerCase()
  const [tab, setTab] = useState<'transfers' | 'lookup'>(tabParam === 'lookup' ? 'lookup' : 'transfers')

  const [loading, setLoading] = useState(true)
  const [stations, setStations] = useState<Station[]>([])
  const [ponds, setPonds] = useState<PondListItem[]>([])
  const [aquacultureEnabled, setAquacultureEnabled] = useState(false)
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([])
  const [transfers, setTransfers] = useState<TransferRecord[]>([])
  const [pondReceipts, setPondReceipts] = useState<PondReceiptRecord[]>([])
  /** When set, API lists only transfers involving this site; creating cross-site moves is not allowed. */
  const [userHomeStation, setUserHomeStation] = useState<{
    id: number
    name: string
  } | null>(null)
  const [stationMode, setStationMode] = useState<'single' | 'multi'>('single')
  const [currencySymbol, setCurrencySymbol] = useState('৳')

  // Create transfer form
  const [fromEndpoint, setFromEndpoint] = useState<TransferEndpoint | null>(null)
  const [toEndpoint, setToEndpoint] = useState<TransferEndpoint | null>(null)
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().split('T')[0])
  const [transferMemo, setTransferMemo] = useState('')
  const [lineRows, setLineRows] = useState<TransferLineRow[]>([{ item_id: 0, quantity: '' }])
  const [saving, setSaving] = useState(false)
  const [transferPostingId, setTransferPostingId] = useState<number | null>(null)
  const [transferDeletingId, setTransferDeletingId] = useState<number | null>(null)
  const [transferUnpostingId, setTransferUnpostingId] = useState<number | null>(null)
  /** Draft being edited in the top form; PUT on save. */
  const [editingInterStationTransferId, setEditingInterStationTransferId] = useState<number | null>(null)
  /** Posted transfer being amended in the form; PUT reverses prior move then applies new lines. */
  const [amendingPostedTransferId, setAmendingPostedTransferId] = useState<number | null>(null)
  const [editingPondReceiptId, setEditingPondReceiptId] = useState<number | null>(null)
  const [viewTransfer, setViewTransfer] = useState<TransferRecord | null>(null)
  const [viewPondReceipt, setViewPondReceipt] = useState<PondReceiptRecord | null>(null)
  const [pondReceiptReversingId, setPondReceiptReversingId] = useState<number | null>(null)
  const [itemAvail, setItemAvail] = useState<Record<number, ItemAvailState>>({})
  const [availFetchSeq, setAvailFetchSeq] = useState(0)

  // Stock lookup
  const [lookupItemId, setLookupItemId] = useState<number | ''>('')
  const [availability, setAvailability] = useState<AvailabilityResponse | null>(null)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupTypeFilter, setLookupTypeFilter] = useState<ItemTypeFilter>('ALL')
  const [transferSearch, setTransferSearch] = useState('')
  const [transferStatusFilter, setTransferStatusFilter] = useState<'all' | 'draft' | 'posted'>('all')
  const [pondReceiptSearch, setPondReceiptSearch] = useState('')
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)

  const loadCore = useCallback(async () => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    setLoading(true)
    try {
      const [stRes, itRes, trRes, pwrRes, pwretRes, coRes] = await Promise.allSettled([
        api.get('/stations/'),
        api.get('/items/', {
          params: {
            paged: '1',
            skip: 0,
            limit: REFERENCE_FETCH_LIMIT,
            sort: 'id',
            dir: 'asc',
          },
        }),
        api.get('/inventory/transfers/'),
        api.get('/inventory/pond-warehouse-receipts/').catch(() => ({ data: [] })),
        api.get('/inventory/pond-warehouse-returns/').catch(() => ({ data: [] })),
        api.get('/companies/current/').catch(() => ({ data: {} })),
      ])
      if (stRes.status === 'fulfilled') {
        const raw = Array.isArray(stRes.value.data) ? stRes.value.data : []
        setStations(
          raw
            .map(
              (s: {
                id?: unknown
                station_name?: string
                station_number?: string
                is_active?: boolean
                default_aquaculture_pond_id?: unknown
                default_aquaculture_pond_name?: string
                default_aquaculture_pond_sort_order?: unknown
              }) => {
                const pidRaw = s.default_aquaculture_pond_id
                const pid =
                  pidRaw == null || pidRaw === ''
                    ? null
                    : typeof pidRaw === 'number'
                      ? pidRaw
                      : Number(pidRaw)
                const sortRaw = s.default_aquaculture_pond_sort_order
                const sortOrder =
                  sortRaw == null || sortRaw === ''
                    ? null
                    : typeof sortRaw === 'number'
                      ? sortRaw
                      : Number(sortRaw)
                return {
                  id: typeof s.id === 'number' ? s.id : Number(s.id),
                  station_name: String(s.station_name || '').trim() || 'Station',
                  station_number: s.station_number != null ? String(s.station_number) : undefined,
                  is_active: s.is_active !== false,
                  default_aquaculture_pond_id:
                    pid != null && Number.isFinite(pid) && pid > 0 ? pid : null,
                  default_aquaculture_pond_name: String(s.default_aquaculture_pond_name || '').trim(),
                  default_aquaculture_pond_sort_order:
                    sortOrder != null && Number.isFinite(sortOrder) ? sortOrder : null,
                }
              },
            )
            .filter(s => Number.isFinite(s.id))
        )
      }
      if (itRes.status === 'fulfilled') {
        const d = itRes.value.data
        const list = isOffsetPagedPayload(d)
          ? (d.results as CatalogItem[])
          : Array.isArray(d)
            ? (d as CatalogItem[])
            : (d as { items?: CatalogItem[] })?.items
        if (Array.isArray(list)) {
          setCatalogItems(
            list
              .map(
                (p: {
                  id: unknown
                  name: string
                  item_number?: string
                  description?: string
                  item_type?: string
                  pos_category?: string
                  is_active?: boolean
                }) => ({
                  id: typeof p.id === 'number' ? p.id : Number(p.id),
                  name: String(p.name || '').trim(),
                  item_number: p.item_number != null ? String(p.item_number) : undefined,
                  description: p.description != null ? String(p.description) : undefined,
                  item_type: p.item_type != null ? String(p.item_type) : undefined,
                  pos_category: p.pos_category,
                  is_active: p.is_active !== false,
                }),
              )
              .filter(p => Number.isFinite(p.id) && p.id > 0 && p.name),
          )
        }
      }
      if (trRes.status === 'fulfilled' && Array.isArray(trRes.value.data)) {
        setTransfers(trRes.value.data as TransferRecord[])
      }
      const receiptRows: PondReceiptRecord[] =
        pwrRes.status === 'fulfilled' && Array.isArray(pwrRes.value.data)
          ? (pwrRes.value.data as PondReceiptRecord[]).map(r => ({
              ...r,
              movement_type: r.movement_type || 'shop_to_pond',
            }))
          : []
      const returnRows: PondReceiptRecord[] =
        pwretRes.status === 'fulfilled' && Array.isArray(pwretRes.value.data)
          ? (pwretRes.value.data as PondReceiptRecord[]).map(r => ({
              ...r,
              movement_type: 'pond_to_shop' as const,
            }))
          : []
      const merged = [...receiptRows, ...returnRows].sort((a, b) => {
        const ta = a.created_at ? Date.parse(a.created_at) : 0
        const tb = b.created_at ? Date.parse(b.created_at) : 0
        return tb - ta
      })
      setPondReceipts(merged)
      if (coRes.status === 'fulfilled' && coRes.value && 'data' in coRes.value) {
        const d = coRes.value.data as {
          station_mode?: string
          aquaculture_enabled?: boolean
          currency?: string
        }
        if (d?.currency) {
          setCurrencySymbol(getCurrencySymbol(d.currency))
        }
        const sm = String(d?.station_mode ?? 'single')
          .toLowerCase()
          .trim()
        setStationMode(sm === 'single' ? 'single' : 'multi')
        setAquacultureEnabled(Boolean(d?.aquaculture_enabled))
        const aqOn = Boolean(d?.aquaculture_enabled)
        if (aqOn) {
          try {
            const pr = await api.get('/aquaculture/ponds/')
            const raw = Array.isArray(pr.data) ? pr.data : []
            setPonds(
              raw
                .map(
                  (p: {
                    id?: unknown
                    name?: string
                    sort_order?: unknown
                    is_active?: boolean
                  }) => ({
                    id: typeof p.id === 'number' ? p.id : Number(p.id),
                    name: String(p.name || '').trim() || 'Pond',
                    sort_order:
                      typeof p.sort_order === 'number'
                        ? p.sort_order
                        : Number(p.sort_order) || 0,
                    is_active: p.is_active !== false,
                  }),
                )
                .filter(p => Number.isFinite(p.id) && p.id > 0),
            )
          } catch {
            setPonds([])
          }
        } else {
          setPonds([])
        }
      } else {
        setAquacultureEnabled(false)
        setPonds([])
      }
    } catch (e) {
      console.error(e)
      toast.error(inventoryT('toastLoadFailed', language))
    } finally {
      setLoading(false)
    }
  }, [router, toast])

  useEffect(() => {
    void loadCore()
  }, [loadCore])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = localStorage.getItem('user')
    if (!raw || raw === 'null' || raw === 'undefined') {
      setUserHomeStation(null)
      return
    }
    try {
      const u = JSON.parse(raw) as {
        home_station_id?: number | null
        home_station_name?: string | null
      }
      if (u?.home_station_id != null && String(u.home_station_id).trim() !== '') {
        const id = Number(u.home_station_id)
        if (Number.isFinite(id) && id > 0) {
          setUserHomeStation({
            id,
            name: (typeof u.home_station_name === 'string' && u.home_station_name.trim()
              ? u.home_station_name.trim()
              : `Station #${id}`),
          })
          return
        }
      }
      setUserHomeStation(null)
    } catch {
      setUserHomeStation(null)
    }
  }, [])

  useEffect(() => {
    const t = (searchParams.get('tab') || 'transfers').toLowerCase()
    setTab(t === 'lookup' ? 'lookup' : 'transfers')
    const it = searchParams.get('item_id') || searchParams.get('item')
    if (it) {
      const n = parseInt(String(it), 10)
      if (Number.isFinite(n) && n > 0) {
        setLookupItemId(n)
        setTab('lookup')
      }
    }
  }, [searchParams])

  const runLookup = useCallback(
    async (itemId: number) => {
      setLookupLoading(true)
      setAvailability(null)
      try {
        const r = await api.get('/inventory/availability/', { params: { item_id: itemId } })
        setAvailability(r.data as AvailabilityResponse)
      } catch (e) {
        toast.error(extractErrorMessage(e, inventoryT('toastLoadAvailabilityFailed', language)))
      } finally {
        setLookupLoading(false)
      }
    },
    [toast]
  )

  useEffect(() => {
    if (tab !== 'lookup') return
    const n = typeof lookupItemId === 'number' ? lookupItemId : parseInt(String(lookupItemId), 10)
    if (Number.isFinite(n) && n > 0) {
      void runLookup(n)
    } else {
      setAvailability(null)
    }
  }, [tab, lookupItemId, runLookup])

  const addLineRow = () => setLineRows(prev => [...prev, { item_id: 0, quantity: '' }])
  const updateLine = (i: number, field: keyof TransferLineRow, value: string | number) => {
    setLineRows(prev => {
      const next = [...prev]
      if (field === 'item_id') {
        next[i] = { ...next[i], item_id: typeof value === 'number' ? value : parseInt(String(value), 10) || 0 }
      } else {
        next[i] = { ...next[i], quantity: String(value) }
      }
      return next
    })
  }
  const removeLine = (i: number) => {
    setLineRows(prev => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)))
  }
  const clearLineRow = (i: number) => {
    setLineRows(prev => {
      const next = [...prev]
      next[i] = { item_id: 0, quantity: '' }
      return next
    })
    setFromEndpoint(null)
    setToEndpoint(null)
    setItemAvail({})
    setAvailFetchSeq(s => s + 1)
  }

  const activeStations = useMemo(() => stations.filter(isStationActive), [stations])
  const activeStationCount = activeStations.length
  const canTransferBetweenSites = activeStationCount >= 2
  const activePondsOrdered = useMemo(
    () => [...ponds].filter(p => p.is_active).sort(comparePondsForTransfer),
    [ponds],
  )
  const canCreateSiteTransfer = canTransferBetweenSites
  const canMoveToPondWarehouse =
    aquacultureEnabled && activePondsOrdered.length > 0 && activeStationCount >= 1
  const canTransferBetweenPonds = aquacultureEnabled && activePondsOrdered.length >= 2
  const canShowTransferForm =
    canTransferBetweenSites || canMoveToPondWarehouse || canTransferBetweenPonds
  const transferStationsOrdered = useMemo(
    () => [...activeStations].sort(compareReceivingStationsByPond),
    [activeStations],
  )
  const transferRoute = useMemo(
    () => classifyTransferRoute(fromEndpoint, toEndpoint),
    [fromEndpoint, toEndpoint],
  )

  const lineItemIdsKey = useMemo(
    () =>
      [...new Set(lineRows.map(r => r.item_id).filter(id => id > 0))]
        .sort((a, b) => a - b)
        .join(','),
    [lineRows],
  )

  useEffect(() => {
    const ids = lineItemIdsKey
      ? lineItemIdsKey.split(',').map(s => parseInt(s, 10)).filter(n => Number.isFinite(n) && n > 0)
      : []
    if (!ids.length) return undefined
    const ac = new AbortController()
    for (const id of ids) {
      setItemAvail(prev => ({ ...prev, [id]: { status: 'loading' } }))
    }
    void Promise.all(
      ids.map(async id => {
        try {
          const r = await api.get('/inventory/availability/', {
            params: { item_id: id },
            signal: ac.signal,
          })
          if (ac.signal.aborted) return
          setItemAvail(prev => ({ ...prev, [id]: { status: 'ok', data: r.data as AvailabilityResponse } }))
        } catch (e: unknown) {
          if (ac.signal.aborted) return
          const err = e as { code?: string; name?: string }
          if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return
          setItemAvail(prev => ({
            ...prev,
            [id]: { status: 'error', message: extractErrorMessage(e, inventoryT('toastLoadStockFailed', language)) },
          }))
        }
      }),
    )
    return () => ac.abort()
  }, [lineItemIdsKey, availFetchSeq])

  const transferDraftIssues = useMemo(() => {
    const issues: string[] = []
    const route = classifyTransferRoute(fromEndpoint, toEndpoint)
    if (!fromEndpoint || !toEndpoint) {
      issues.push(inventoryT('issueSelectBoth', language))
      return issues
    }
    if (transferEndpointsEqual(fromEndpoint, toEndpoint)) {
      issues.push(inventoryT('issueSourceDestDifferent', language))
      return issues
    }
    if (editingInterStationTransferId != null && route !== 'station-station') {
      issues.push(inventoryT('issueDraftEditOnly', language))
      return issues
    }
    if (amendingPostedTransferId != null && route !== 'station-station') {
      issues.push(inventoryT('issuePostedEditOnly', language))
      return issues
    }
    if (editingPondReceiptId != null && route !== 'station-pond') {
      issues.push(inventoryT('issueReceiptEditOnly', language))
      return issues
    }
    if (route === 'pond-station' && !canMoveToPondWarehouse) {
      issues.push(inventoryT('issueEnablePondsReturn', language))
      return issues
    }
    if (route === 'station-station' && !canTransferBetweenSites) {
      issues.push(inventoryT('issueTwoSitesRequired', language))
      return issues
    }
    if (route === 'station-pond' && !canMoveToPondWarehouse) {
      issues.push(inventoryT('issueEnablePondsMove', language))
      return issues
    }
    if (route === 'pond-pond' && activePondsOrdered.length < 2) {
      issues.push(inventoryT('issueTwoPondsRequired', language))
      return issues
    }
    const validLines = lineRows
      .map((r, i) => ({ ...r, i, q: parseQtyInput(r.quantity) }))
      .filter(x => x.item_id > 0)
    if (!validLines.length) {
      issues.push(inventoryT('issueAddProduct', language))
    }
    for (const row of validLines) {
      if (!Number.isFinite(row.q) || row.q <= 0) {
        issues.push(inventoryT('issueLineQty', language, { n: row.i + 1 }))
        continue
      }
      const st = itemAvail[row.item_id]
      if (!st || st.status === 'loading') {
        issues.push(inventoryT('issueLineLoading', language, { n: row.i + 1 }))
        continue
      }
      if (st.status === 'error') {
        issues.push(`Line ${row.i + 1}: ${st.message}`)
        continue
      }
      if (st.status !== 'ok') {
        if (st.status === 'idle') {
          issues.push(inventoryT('issueLineNotLoaded', language, { n: row.i + 1 }))
        }
        continue
      }
      const data = st.data
      if (!data.tracks_per_station) {
        issues.push(
          inventoryT('issueLineNotMovable', language, { n: row.i + 1, name: data.name }),
        )
        continue
      }
      const { qtyNum, unit } = qtyAtSourceEndpoint(data, fromEndpoint)
      const others = sumQtySameItemOtherLines(lineRows, row.item_id, row.i)
      const editingId = editingInterStationTransferId ?? amendingPostedTransferId
      const originalTransfer = editingId != null ? transfers.find(x => x.id === editingId) ?? null : null
      const originalReceipt =
        editingPondReceiptId != null ? pondReceipts.find(x => x.id === editingPondReceiptId) ?? null : null
      const credit =
        transferSourceCreditQty(row.item_id, fromEndpoint, originalTransfer) +
        pondReceiptSourceCreditQty(row.item_id, fromEndpoint, originalReceipt)
      const effectiveAtSource = qtyNum + credit
      const maxForLine = effectiveAtSource - others
      if (effectiveAtSource <= 0 && row.q > 0) {
        issues.push(inventoryT('issueLineNoStock', language, { n: row.i + 1 }))
      } else if (row.q > maxForLine + 1e-9) {
        const creditPart =
          credit > 0
            ? inventoryT('creditWhenUpdated', language, {
                qty: credit.toLocaleString(),
                unit,
              })
            : ''
        const othersPart =
          others > 0
            ? inventoryT('othersOnLines', language, {
                qty: others.toLocaleString(),
                unit,
              })
            : ''
        issues.push(
          inventoryT('issueLineExceeds', language, {
            n: row.i + 1,
            atSource: effectiveAtSource.toLocaleString(),
            unit,
            credit: creditPart,
            others: othersPart,
            max: Math.max(0, maxForLine).toLocaleString(),
          }),
        )
      }
    }
    return issues
  }, [
    fromEndpoint,
    toEndpoint,
    lineRows,
    itemAvail,
    editingInterStationTransferId,
    amendingPostedTransferId,
    editingPondReceiptId,
    transfers,
    pondReceipts,
    canTransferBetweenSites,
    canMoveToPondWarehouse,
    activePondsOrdered.length,
    language,
  ])

  const applyMaxQty = useCallback(
    (lineIndex: number) => {
      setLineRows(prev => {
        const row = prev[lineIndex]
        if (!row || !fromEndpoint || row.item_id <= 0) return prev
        const st = itemAvail[row.item_id]
        if (!st || st.status !== 'ok' || !st.data.tracks_per_station) return prev
        const { qtyNum } = qtyAtSourceEndpoint(st.data, fromEndpoint)
        const others = sumQtySameItemOtherLines(prev, row.item_id, lineIndex)
        const editingId = editingInterStationTransferId ?? amendingPostedTransferId
        const originalTransfer =
          editingId != null ? transfers.find(x => x.id === editingId) ?? null : null
        const originalReceipt =
          editingPondReceiptId != null ? pondReceipts.find(x => x.id === editingPondReceiptId) ?? null : null
        const credit =
          transferSourceCreditQty(row.item_id, fromEndpoint, originalTransfer) +
          pondReceiptSourceCreditQty(row.item_id, fromEndpoint, originalReceipt)
        const max = Math.max(0, qtyNum + credit - others)
        const qtyStr = Number.isInteger(max) ? String(max) : String(Math.round(max * 1e6) / 1e6)
        const next = [...prev]
        next[lineIndex] = { ...next[lineIndex], quantity: qtyStr }
        return next
      })
    },
    [fromEndpoint, itemAvail, editingInterStationTransferId, amendingPostedTransferId, editingPondReceiptId, transfers, pondReceipts],
  )

  const refreshLineAvailability = useCallback(() => {
    setAvailFetchSeq(s => s + 1)
  }, [])

  const refreshAfterInventoryChange = useCallback(async () => {
    await loadCore()
    refreshLineAvailability()
    const n = typeof lookupItemId === 'number' ? lookupItemId : parseInt(String(lookupItemId), 10)
    if (tab === 'lookup' && Number.isFinite(n) && n > 0) {
      await runLookup(n)
    }
  }, [loadCore, refreshLineAvailability, lookupItemId, tab, runLookup])

  const loadTransferIntoForm = (t: TransferRecord) => {
    setFromEndpoint({ kind: 'station', id: t.from_station_id })
    setToEndpoint({ kind: 'station', id: t.to_station_id })
    const raw = (t.transfer_date || '').trim()
    const d = raw.includes('T') ? raw.split('T')[0] : raw.slice(0, 10)
    setTransferDate(d || new Date().toISOString().split('T')[0])
    setTransferMemo(t.memo || '')
    setLineRows(
      t.lines?.length
        ? t.lines.map(l => ({ item_id: l.item_id, quantity: String(l.quantity) }))
        : [{ item_id: 0, quantity: '' }],
    )
    setItemAvail({})
    setAvailFetchSeq(s => s + 1)
  }

  const startEditInterStationDraft = (t: TransferRecord) => {
    if (t.status !== 'draft' || !canCreateSiteTransfer) return
    setAmendingPostedTransferId(null)
    setEditingPondReceiptId(null)
    setEditingInterStationTransferId(t.id)
    loadTransferIntoForm(t)
    requestAnimationFrame(() => {
      document.getElementById('inventory-transfer-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const startAmendPostedTransfer = (t: TransferRecord) => {
    if (t.status !== 'posted' || !canCreateSiteTransfer) return
    setEditingInterStationTransferId(null)
    setEditingPondReceiptId(null)
    setAmendingPostedTransferId(t.id)
    loadTransferIntoForm(t)
    requestAnimationFrame(() => {
      document.getElementById('inventory-transfer-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const loadPondReceiptIntoForm = (r: PondReceiptRecord) => {
    if (pondMovementIsReturn(r)) return
    setFromEndpoint({ kind: 'station', id: r.from_station_id! })
    setToEndpoint({ kind: 'pond', id: r.pond_id })
    setTransferDate(new Date().toISOString().split('T')[0])
    setTransferMemo('')
    setLineRows(
      r.lines?.length
        ? r.lines.map(l => ({ item_id: l.item_id, quantity: String(l.quantity) }))
        : [{ item_id: 0, quantity: '' }],
    )
    setItemAvail({})
    setAvailFetchSeq(s => s + 1)
  }

  const startEditPondReceipt = (r: PondReceiptRecord) => {
    if (!canMoveToPondWarehouse) return
    setEditingInterStationTransferId(null)
    setAmendingPostedTransferId(null)
    setEditingPondReceiptId(r.id)
    loadPondReceiptIntoForm(r)
    requestAnimationFrame(() => {
      document.getElementById('inventory-transfer-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  const cancelEditInterStationDraft = () => {
    setEditingInterStationTransferId(null)
    setAmendingPostedTransferId(null)
    setEditingPondReceiptId(null)
    setLineRows([{ item_id: 0, quantity: '' }])
    setTransferMemo('')
    setToEndpoint(null)
    setItemAvail({})
    setAvailFetchSeq(s => s + 1)
  }

  const submitTransferDraft = async () => {
    if (transferDraftIssues.length > 0) {
      toast.error(transferDraftIssues[0] || inventoryT('toastFixForm', language))
      return
    }
    if (!fromEndpoint || !toEndpoint) {
      toast.error(inventoryT('toastSelectSourceDest', language))
      return
    }
    const route = classifyTransferRoute(fromEndpoint, toEndpoint)
    const lines = lineRows
      .map((r, idx) => ({
        item_id: r.item_id,
        q: parseQtyInput(r.quantity),
        idx,
      }))
      .filter(r => r.item_id > 0 && Number.isFinite(r.q) && r.q > 0)
    if (!lines.length) {
      toast.error(inventoryT('toastAddLine', language))
      return
    }
    setSaving(true)
    try {
      const linePayload = lines.map(x => ({ item_id: x.item_id, quantity: String(x.q) }))
      if (route === 'station-station' && (editingInterStationTransferId != null || amendingPostedTransferId != null)) {
        const tid = editingInterStationTransferId ?? amendingPostedTransferId
        await api.put(`/inventory/transfers/${tid}/`, {
          from_station_id: fromEndpoint.id,
          to_station_id: toEndpoint.id,
          transfer_date: transferDate,
          memo: transferMemo || '',
          lines: linePayload,
        })
        toast.success(
          amendingPostedTransferId != null
            ? inventoryT('toastTransferUpdatedSites', language)
            : inventoryT('toastDraftUpdated', language),
        )
        setEditingInterStationTransferId(null)
        setAmendingPostedTransferId(null)
      } else if (route === 'station-station') {
        await api.post('/inventory/transfers/', {
          from_station_id: fromEndpoint.id,
          to_station_id: toEndpoint.id,
          transfer_date: transferDate,
          memo: transferMemo || '',
          lines: linePayload,
        })
        toast.success(inventoryT('toastDraftCreated', language))
      } else if (route === 'station-pond' && editingPondReceiptId != null) {
        await api.put(`/inventory/pond-warehouse-receipts/${editingPondReceiptId}/`, {
          station_id: fromEndpoint.id,
          pond_id: toEndpoint.id,
          items: linePayload,
        })
        toast.success(inventoryT('toastPondReceiptUpdated', language))
        setEditingPondReceiptId(null)
      } else if (route === 'station-pond') {
        const pm = activePondsOrdered.find(p => p.id === toEndpoint.id)
        const pname = (pm?.name || '').trim() || inventoryT('pondNum', language, { id: toEndpoint.id })
        await api.post('/aquaculture/pond-warehouse-transfer/', {
          station_id: fromEndpoint.id,
          pond_id: toEndpoint.id,
          items: linePayload,
        })
        toast.success(inventoryT('toastStockMovedToPond', language, { name: pname }))
      } else if (route === 'pond-pond') {
        await api.post('/aquaculture/pond-warehouse-inter-pond-transfers/', {
          from_pond_id: fromEndpoint.id,
          to_pond_id: toEndpoint.id,
          items: linePayload,
          memo: transferMemo || '',
        })
        toast.success(inventoryT('toastPondMoved', language))
      } else if (route === 'pond-station') {
        const sm = activeStations.find(s => s.id === toEndpoint.id)
        const sname = (sm && formatStationTransferLabel(sm)) || inventoryT('siteNum', language, { id: toEndpoint.id })
        const pm = activePondsOrdered.find(p => p.id === fromEndpoint.id)
        const pname = (pm?.name || '').trim() || inventoryT('pondNum', language, { id: fromEndpoint.id })
        await api.post('/aquaculture/pond-warehouse-return/', {
          station_id: toEndpoint.id,
          pond_id: fromEndpoint.id,
          items: linePayload,
          memo: transferMemo || '',
        })
        toast.success(inventoryT('toastStockReturned', language, { pond: pname, site: sname }))
      } else {
        toast.error(inventoryT('toastRouteNotSupported', language))
        return
      }
      setLineRows([{ item_id: 0, quantity: '' }])
      setTransferMemo('')
      setItemAvail({})
      await refreshAfterInventoryChange()
    } catch (e) {
      toast.error(
        extractErrorMessage(
          e,
          editingInterStationTransferId != null ||
          amendingPostedTransferId != null ||
          editingPondReceiptId != null
            ? inventoryT('toastUpdateFailed', language)
            : inventoryT('toastCreateFailed', language),
        ),
      )
    } finally {
      setSaving(false)
    }
  }

  const postTransfer = async (id: number) => {
    setTransferPostingId(id)
    try {
      await api.post(`/inventory/transfers/${id}/`)
      toast.success(inventoryT('toastPosted', language))
      await refreshAfterInventoryChange()
    } catch (e) {
      toast.error(extractErrorMessage(e, inventoryT('toastPostFailed', language)))
    } finally {
      setTransferPostingId(null)
    }
  }

  const deleteDraft = async (id: number) => {
    setTransferDeletingId(id)
    try {
      await api.delete(`/inventory/transfers/${id}/delete/`)
      toast.success(inventoryT('toastDraftDeleted', language))
      await refreshAfterInventoryChange()
    } catch (e) {
      toast.error(extractErrorMessage(e, inventoryT('toastDeleteFailed', language)))
    } finally {
      setTransferDeletingId(null)
    }
  }

  const unpostTransfer = async (id: number) => {
    setTransferUnpostingId(id)
    try {
      await api.post(`/inventory/transfers/${id}/unpost/`)
      toast.success(inventoryT('toastRolledBack', language))
      await refreshAfterInventoryChange()
    } catch (e) {
      toast.error(extractErrorMessage(e, inventoryT('toastRollBackFailed', language)))
    } finally {
      setTransferUnpostingId(null)
    }
  }

  const reversePondMovement = async (r: PondReceiptRecord) => {
    setPondReceiptReversingId(r.id)
    try {
      if (pondMovementIsReturn(r)) {
        await api.post(`/inventory/pond-warehouse-returns/${r.id}/reverse/`)
        toast.success(inventoryT('toastReturnReversed', language))
      } else {
        await api.post(`/inventory/pond-warehouse-receipts/${r.id}/reverse/`)
        toast.success(inventoryT('toastReceiptReversed', language))
      }
      await refreshAfterInventoryChange()
    } catch (e) {
      toast.error(extractErrorMessage(e, inventoryT('toastReverseFailed', language)))
    } finally {
      setPondReceiptReversingId(null)
    }
  }

  const runConfirmAction = async () => {
    if (!confirmAction) return
    setConfirmBusy(true)
    try {
      if (confirmAction.kind === 'post') await postTransfer(confirmAction.id)
      else if (confirmAction.kind === 'delete') await deleteDraft(confirmAction.id)
      else if (confirmAction.kind === 'unpost') await unpostTransfer(confirmAction.id)
      else if (confirmAction.kind === 'reverse') {
        const row = pondReceipts.find(
          r =>
            r.id === confirmAction.id &&
            (confirmAction.movementType ? r.movement_type === confirmAction.movementType : true),
        )
        if (row) await reversePondMovement(row)
      }
      setConfirmAction(null)
    } finally {
      setConfirmBusy(false)
    }
  }

  const transferListBusy =
    transferPostingId !== null ||
    transferDeletingId !== null ||
    transferUnpostingId !== null ||
    pondReceiptReversingId !== null

  const transferStats = useMemo(
    () => ({
      draftCount: transfers.filter(t => t.status === 'draft').length,
      postedCount: transfers.filter(t => t.status === 'posted').length,
      pondReceiptCount: pondReceipts.length,
    }),
    [transfers, pondReceipts],
  )

  const filteredTransfers = useMemo(() => {
    const q = transferSearch.trim().toLowerCase()
    return transfers.filter(t => {
      if (transferStatusFilter !== 'all' && t.status !== transferStatusFilter) return false
      if (!q) return true
      const hay = [
        t.transfer_number,
        t.from_station_name,
        t.to_station_name,
        t.memo,
        ...(t.lines?.map(l => `${l.item_name} ${l.quantity}`) || []),
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [transfers, transferSearch, transferStatusFilter])

  const filteredPondReceipts = useMemo(() => {
    const q = pondReceiptSearch.trim().toLowerCase()
    if (!q) return pondReceipts
    return pondReceipts.filter(r => {
      const hay = [
        pondMovementDocNumber(r),
        r.from_station_name,
        r.to_station_name,
        r.pond_name,
        r.movement_type,
        ...(r.lines?.map(l => `${l.item_name} ${l.quantity}`) || []),
      ]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [pondReceipts, pondReceiptSearch])

  const typeFilteredCatalogItems = useMemo(() => {
    return catalogItems.filter(p => catalogItemMatchesTypeFilter(p, lookupTypeFilter))
  }, [catalogItems, lookupTypeFilter])

  const filteredLookupItems = useMemo(() => {
    if (typeof lookupItemId === 'number' && lookupItemId > 0) {
      const selected = catalogItems.find(p => p.id === lookupItemId)
      if (selected && !typeFilteredCatalogItems.some(p => p.id === selected.id)) {
        return [selected, ...typeFilteredCatalogItems]
      }
    }
    return typeFilteredCatalogItems
  }, [catalogItems, lookupTypeFilter, lookupItemId, typeFilteredCatalogItems])

  useEffect(() => {
    if (loading) return
    if (userHomeStation?.id) {
      setFromEndpoint({ kind: 'station', id: userHomeStation.id })
    }
  }, [loading, userHomeStation])

  useEffect(() => {
    if (loading || !canShowTransferForm) return
    if (fromEndpoint) return
    if (userHomeStation?.id) return
    if (activeStations.length === 1) {
      setFromEndpoint({ kind: 'station', id: activeStations[0].id })
    }
  }, [loading, canShowTransferForm, fromEndpoint, userHomeStation, activeStations])

  useEffect(() => {
    if (fromEndpoint && toEndpoint && transferEndpointsEqual(fromEndpoint, toEndpoint)) {
      setToEndpoint(null)
    }
  }, [fromEndpoint, toEndpoint])

  const setTabAndUrl = (next: 'transfers' | 'lookup') => {
    setTab(next)
    const q = new URLSearchParams(searchParams.toString())
    q.set('tab', next)
    if (next === 'transfers') {
      q.delete('item_id')
    }
    router.replace(`/inventory?${q.toString()}`, { scroll: false })
  }

  const confirmCopy = useMemo(() => {
    if (!confirmAction) return { title: '', body: '', confirmLabel: inventoryT('confirm', language), danger: false }
    switch (confirmAction.kind) {
      case 'post':
        return {
          title: inventoryT('postTransferTitle', language),
          body: inventoryT('postTransferBody', language),
          confirmLabel: inventoryT('postTransferLabel', language),
          danger: false,
        }
      case 'delete':
        return {
          title: inventoryT('deleteDraftConfirmTitle', language),
          body: inventoryT('deleteDraftBody', language),
          confirmLabel: inventoryT('deleteDraftLabel', language),
          danger: true,
        }
      case 'unpost':
        return {
          title: inventoryT('rollBackTitle', language),
          body: inventoryT('rollBackBody', language),
          confirmLabel: inventoryT('rollBackLabel', language),
          danger: true,
        }
      case 'reverse':
        return confirmAction.movementType === 'pond_to_shop'
          ? {
              title: inventoryT('reversePondShopTitle', language),
              body: inventoryT('reversePondShopBody', language),
              confirmLabel: inventoryT('reverseReturnLabel', language),
              danger: true,
            }
          : {
              title: inventoryT('reverseShopPondTitle', language),
              body: inventoryT('reverseShopPondBody', language),
              confirmLabel: inventoryT('reverseReceiptLabel', language),
              danger: true,
            }
      default:
        return { title: '', body: '', confirmLabel: inventoryT('confirm', language), danger: false }
    }
  }, [confirmAction, language])

  return (
    <PageLayout containScroll className="bg-slate-50">
      <div className="flex h-full min-h-0 flex-col">
        <div className="shrink-0 app-scroll-pad pb-3">
          <ErpPageShell
            flush
            showBackLink={false}
            eyebrow={pageMeta.eyebrow ?? inventoryT('inventoryEyebrow', language)}
            title={pageMeta.title}
            titleIcon={Package}
            description={pageMeta.description}
            maxWidthClass="max-w-[1600px]"
            contentClassName="mt-4"
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href="/items"
                  className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur hover:bg-white/20"
                >
                  <Package className="h-4 w-4" />
                  {inventoryT('productsLink', language)}
                </Link>
                <Link
                  href="/cashier"
                  className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur hover:bg-white/20"
                >
                  <ArrowRightLeft className="h-4 w-4" />
                  {inventoryT('cashierLink', language)}
                </Link>
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur hover:bg-white/20 disabled:opacity-50"
                  onClick={() => void loadCore()}
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                  {t('refresh')}
                </button>
              </div>
            }
            stats={
              !loading ? (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <StatCard
                    label={inventoryT('activeSites', language)}
                    value={activeStationCount}
                    hint={
                      stationMode === 'single'
                        ? inventoryT('singleSiteHint', language)
                        : inventoryT('multiSiteHint', language)
                    }
                    icon={Building2}
                  />
                  <StatCard
                    label={inventoryT('draftTransfers', language)}
                    value={transferStats.draftCount}
                    hint={inventoryT('draftTransfersHint', language)}
                    icon={FileEdit}
                    accent="amber"
                  />
                  <StatCard
                    label={inventoryT('postedTransfers', language)}
                    value={transferStats.postedCount}
                    hint={inventoryT('postedTransfersHint', language)}
                    icon={CheckCircle2}
                    accent="emerald"
                  />
                  {aquacultureEnabled ? (
                    <StatCard
                      label={inventoryT('pondReceipts', language)}
                      value={transferStats.pondReceiptCount}
                      hint={inventoryT('pondReceiptsHint', language)}
                      icon={Sprout}
                      accent="teal"
                    />
                  ) : (
                    <StatCard
                      label={inventoryT('trackedProducts', language)}
                      value={catalogItems.length}
                      hint={inventoryT('trackedProductsHint', language)}
                      icon={Package}
                    />
                  )}
                </div>
              ) : undefined
            }
          >
          {userHomeStation && (
            <div className="flex items-start gap-3 rounded-xl border border-sky-200/90 bg-gradient-to-r from-sky-50/95 to-card px-4 py-3 text-sm text-sky-950 shadow-sm dark:border-sky-800/60 dark:from-sky-950/30 dark:to-card dark:text-sky-100">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
              <div>
                <p className="font-medium">{inventoryT('yourSite', language)} {userHomeStation.name}</p>
                <p className="mt-1 text-sky-900/90 dark:text-sky-200/90">
                  {inventoryT('yourSiteHint', language, { site: userHomeStation.name })}
                </p>
              </div>
            </div>
          )}

          <div
            className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-muted/50 p-1 shadow-sm"
            role="tablist"
            aria-label={inventoryT('inventoryViews', language)}
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'transfers'}
              onClick={() => setTabAndUrl('transfers')}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                tab === 'transfers'
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-muted-foreground hover:bg-background/80 hover:text-foreground'
              }`}
            >
              <ArrowRightLeft className="h-4 w-4 shrink-0" />
              {inventoryT('tabTransfers', language)}
              {!loading && transferStats.draftCount > 0 ? (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
                  {transferStats.draftCount}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'lookup'}
              onClick={() => setTabAndUrl('lookup')}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                tab === 'lookup'
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-muted-foreground hover:bg-background/80 hover:text-foreground'
              }`}
            >
              <Search className="h-4 w-4 shrink-0" />
              {inventoryT('tabStockByStation', language)}
            </button>
            <Link
              href="/inventory/adjustments"
              className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium text-muted-foreground transition-all hover:bg-background/80 hover:text-foreground"
            >
              <SlidersHorizontal className="h-4 w-4 shrink-0" />
              {inventoryT('tabAdjustments', language)}
            </Link>
          </div>
          </ErpPageShell>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="app-scroll-pad pt-0">
            <div className="mx-auto w-full max-w-[1600px] space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-card px-10 py-16 text-center shadow-sm">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <div>
                <p className="text-sm font-medium text-foreground">{inventoryT('loadingInventory', language)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{inventoryT('loadingInventoryHint', language)}</p>
              </div>
            </div>
          ) : tab === 'lookup' ? (
            <div className="space-y-6 rounded-2xl border border-border bg-card p-5 shadow-md ring-1 ring-black/5 dark:ring-white/10 sm:p-7">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">{inventoryT('availabilityByLocation', language)}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {inventoryT('availabilityHint', language)}
                </p>
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.5fr)_auto] lg:items-end">
                <div className="min-w-0">
                  <label className="text-sm font-medium" htmlFor="inv-lookup-type">
                    {inventoryT('type', language)}
                  </label>
                  <select
                    id="inv-lookup-type"
                    className={selectClassName + ' mt-1'}
                    value={lookupTypeFilter}
                    onChange={e => setLookupTypeFilter(e.target.value as ItemTypeFilter)}
                  >
                    {(['ALL', 'INVENTORY', 'NON_INVENTORY', 'SERVICE'] as const).map(type => (
                      <option key={type} value={type}>
                        {type === 'ALL' ? inventoryT('allTypes', language) : type.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="min-w-0">
                  <label className="text-sm font-medium" htmlFor="inv-lookup-item">
                    {inventoryT('product', language)}
                  </label>
                  <CatalogItemCombobox
                    id="inv-lookup-item"
                    value={lookupItemId}
                    onChange={id => {
                      setLookupItemId(id)
                      const q = new URLSearchParams(searchParams.toString())
                      q.set('tab', 'lookup')
                      if (typeof id === 'number' && id > 0) q.set('item_id', String(id))
                      else q.delete('item_id')
                      router.replace(`/inventory?${q.toString()}`, { scroll: false })
                    }}
                    items={filteredLookupItems}
                    emptyLabel={inventoryT('selectProductDash', language)}
                    placeholder={inventoryT('searchProducts', language)}
                    className={selectClassName + ' mt-1'}
                    includeSelectedWhenFilteredOut
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {inventoryT('productsOfTotal', language, {
                      count: typeFilteredCatalogItems.length,
                      total: catalogItems.length,
                    })}
                    {lookupTypeFilter !== 'ALL' ? ` · ${lookupTypeFilter.replace('_', ' ').toLowerCase()}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className={btnSecondary}
                  onClick={() => {
                    const n = typeof lookupItemId === 'number' ? lookupItemId : parseInt(String(lookupItemId), 10)
                    if (Number.isFinite(n) && n > 0) void runLookup(n)
                  }}
                  disabled={lookupLoading}
                >
                  {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  {inventoryT('refresh', language)}
                </button>
              </div>

              {lookupLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : null}

              {!lookupLoading && !availability && (
                <div className="rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 px-6 py-10 text-center">
                  <Package className="mx-auto h-10 w-10 text-muted-foreground/70" />
                  <p className="mt-3 text-sm font-medium text-foreground">{inventoryT('selectProductView', language)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {inventoryT('selectProductViewHint', language)}
                  </p>
                </div>
              )}

              {!lookupLoading && availability && (
                <div className="space-y-4">
                  {!availability.tracks_per_station ? (
                    <div className="flex items-start gap-3 rounded-xl border border-amber-200/80 bg-amber-50/80 p-4 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100">
                      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
                      <div>
                        <p className="font-semibold">{availability.name}</p>
                        <p className="mt-1">{availability.message || inventoryT('notTrackedPerStation', language)}</p>
                        <p className="mt-2 text-xs text-amber-900/80 dark:text-amber-200/80">
                          {inventoryT('fuelManagedHint', language)}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="rounded-xl border border-border/80 bg-gradient-to-br from-muted/30 to-card p-4 shadow-sm">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          {inventoryT('companyTotal', language)}
                        </p>
                        <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                          {availability.total_on_hand}{' '}
                          <span className="text-base font-medium text-muted-foreground">
                            {availability.unit || inventoryT('units', language)}
                          </span>
                        </p>
                      </div>
                      <div className="grid gap-4 xl:grid-cols-2">
                        <div className="overflow-hidden rounded-xl border border-border">
                          <div className="border-b border-border bg-muted/40 px-4 py-3">
                            <h3 className="text-sm font-semibold">{inventoryT('shopSites', language)}</h3>
                            <p className="text-xs text-muted-foreground">{inventoryT('perSiteBins', language)}</p>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[320px] text-sm">
                              <thead className="bg-muted/30 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                                <tr>
                                  <th className="px-4 py-2.5">{inventoryT('site', language)}</th>
                                  <th className="px-4 py-2.5 text-right">{inventoryT('quantity', language)}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {availability.stations.length === 0 ? (
                                  <tr>
                                    <td colSpan={2} className="px-4 py-8 text-center text-muted-foreground">
                                      {inventoryT('noPerSiteRows', language)}
                                    </td>
                                  </tr>
                                ) : (
                                  availability.stations.map(s => {
                                    const isMySite = userHomeStation && s.station_id === userHomeStation.id
                                    return (
                                      <tr
                                        key={s.station_id}
                                        className={`border-t border-border/70 ${isMySite ? 'bg-primary/5' : ''}`}
                                      >
                                        <td className="px-4 py-3">
                                          <span className="inline-flex items-center gap-1.5">
                                            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                                            {s.station_name}
                                            {s.station_number ? (
                                              <span className="text-xs text-muted-foreground">
                                                ({s.station_number})
                                              </span>
                                            ) : null}
                                          </span>
                                          {isMySite ? (
                                            <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                                              {inventoryT('yourSiteBadge', language)}
                                            </span>
                                          ) : null}
                                        </td>
                                        <td className="px-4 py-3 text-right font-medium tabular-nums">
                                          {s.quantity}
                                        </td>
                                      </tr>
                                    )
                                  })
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        {(availability.pond_warehouses?.length ?? 0) > 0 ? (
                          <div className="overflow-hidden rounded-xl border border-teal-200/80 dark:border-teal-900/40">
                            <div className="border-b border-teal-200/70 bg-teal-50/90 px-4 py-3 dark:border-teal-900/40 dark:bg-teal-950/35">
                              <h3 className="text-sm font-semibold text-teal-950 dark:text-teal-100">
                                {inventoryT('pondWarehouses', language)}
                              </h3>
                              <p className="text-xs text-teal-800/80 dark:text-teal-200/80">
                                {inventoryT('pondWarehousesHint', language)}
                              </p>
                            </div>
                            <div className="overflow-x-auto">
                              <table className="w-full min-w-[320px] text-sm">
                                <thead className="bg-teal-50/60 text-left text-xs font-medium uppercase tracking-wide text-teal-900/70 dark:bg-teal-950/25 dark:text-teal-200/70">
                                  <tr>
                                    <th className="px-4 py-2.5">{inventoryT('pond', language)}</th>
                                    <th className="px-4 py-2.5 text-right">{inventoryT('quantity', language)}</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {availability.pond_warehouses!.map(p => (
                                    <tr key={p.pond_id} className="border-t border-border/70">
                                      <td className="px-4 py-3">
                                        <span className="inline-flex items-center gap-1.5">
                                          <Sprout className="h-3.5 w-3.5 text-teal-700 dark:text-teal-400" />
                                          {p.pond_name}
                                        </span>
                                      </td>
                                      <td className="px-4 py-3 text-right font-medium tabular-nums">
                                        {p.quantity}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-center rounded-xl border border-dashed border-muted-foreground/30 bg-muted/15 px-6 py-10 text-center">
                            <div>
                              <Sprout className="mx-auto h-8 w-8 text-muted-foreground/60" />
                              <p className="mt-2 text-sm font-medium text-foreground">{inventoryT('noPondWarehouseStock', language)}</p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {inventoryT('noPondWarehouseStockHint', language)}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex w-full min-w-0 flex-col gap-5">
              {!canShowTransferForm ? (
                <div className="rounded-2xl border border-dashed border-muted-foreground/35 bg-muted/20 p-6 text-center shadow-sm sm:p-8">
                  <ArrowRightLeft className="mx-auto h-10 w-10 text-muted-foreground/60" />
                  <h2 className="mt-3 text-lg font-semibold text-foreground">{inventoryT('transfersNotAvailable', language)}</h2>
                  <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground">
                    {inventoryT('transfersNotAvailableHintAlt', language)}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    <Link href="/stations" className={btnSecondary}>
                      <Building2 className="h-4 w-4" />
                      {inventoryT('manageSites', language)}
                    </Link>
                    <Link href="/company" className={btnSecondary}>
                      {inventoryT('companySettings', language)}
                    </Link>
                  </div>
                </div>
              ) : (
                <div
                  id="inventory-transfer-form"
                  className="w-full min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm ring-1 ring-black/5 dark:ring-white/10 scroll-mt-4"
                >
                  <div className="border-b border-border bg-gradient-to-r from-muted/40 to-card px-4 py-4 sm:px-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-lg font-semibold tracking-tight">
                          {editingPondReceiptId != null
                            ? inventoryT('editPondReceipt', language, {
                                num:
                                  pondReceipts.find(x => x.id === editingPondReceiptId)?.receipt_number ||
                                  `PWR-${editingPondReceiptId}`,
                              })
                            : amendingPostedTransferId != null
                              ? inventoryT('editPostedTransfer', language, {
                                  num:
                                    transfers.find(x => x.id === amendingPostedTransferId)?.transfer_number ||
                                    `TR-${amendingPostedTransferId}`,
                                })
                              : editingInterStationTransferId != null
                                ? inventoryT('editDraftTransfer', language, {
                                    num:
                                      transfers.find(x => x.id === editingInterStationTransferId)?.transfer_number ||
                                      `TR-${editingInterStationTransferId}`,
                                  })
                                : inventoryT('newStockTransfer', language)}
                        </h2>
                        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                          {editingPondReceiptId != null
                            ? inventoryT('hintEditPondReceipt', language)
                            : amendingPostedTransferId != null
                            ? inventoryT('hintEditPosted', language)
                            : transferRoute === 'station-station' ||
                                editingInterStationTransferId != null ||
                                amendingPostedTransferId != null
                              ? inventoryT('hintSiteToSite', language)
                              : transferRoute === 'station-pond'
                                ? inventoryT('hintShopToPond', language)
                                : transferRoute === 'pond-station'
                                  ? inventoryT('hintPondToShop', language)
                                : transferRoute === 'pond-pond'
                                  ? inventoryT('hintPondToPond', language)
                                  : inventoryT('hintChooseRoute', language)}
                        </p>
                      </div>
                      {canCreateSiteTransfer ? (
                        <details className="max-w-md rounded-lg border border-border/70 bg-background/70 px-3 py-2 text-sm">
                          <summary className="cursor-pointer list-none font-medium text-foreground [&::-webkit-details-marker]:hidden">
                            <span className="inline-flex items-center gap-1.5">
                              <Info className="h-4 w-4 text-muted-foreground" />
                              {inventoryT('howPostingAffects', language)}
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            </span>
                          </summary>
                          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                            {inventoryT('postingBooksHint', language)}
                          </p>
                        </details>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-5 p-4 sm:p-5">
                    <section
                      className="space-y-3 rounded-lg border border-border/60 bg-muted/10 p-3 sm:p-4"
                      aria-labelledby="inv-route-heading"
                    >
                      <h3
                        id="inv-route-heading"
                        className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                      >
                        <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden />
                        {inventoryT('routeAndDocument', language)}
                      </h3>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                        <div className="min-w-0 flex-1 space-y-1">
                          <label className="text-sm font-medium text-foreground" htmlFor="inv-from-st">
                            {inventoryT('sendFrom', language)}
                          </label>
                          <select
                            id="inv-from-st"
                            className={selectClassName}
                            disabled={Boolean(userHomeStation)}
                            aria-disabled={Boolean(userHomeStation)}
                            value={transferEndpointKey(fromEndpoint)}
                            onChange={e =>
                              setFromEndpoint(parseTransferEndpointKey(e.target.value))
                            }
                          >
                            <option value="">{inventoryT('fromPlaceholder', language)}</option>
                            {renderTransferEndpointOptions(
                              transferStationsOrdered,
                              activePondsOrdered,
                              aquacultureEnabled,
                              toEndpoint,
                              userHomeStation,
                              'from',
                              language,
                            )}
                          </select>
                          <p className="text-xs text-muted-foreground">
                            {inventoryT('sendFromHint', language)}
                          </p>
                        </div>
                        <div
                          className="hidden shrink-0 justify-center pb-2 text-muted-foreground sm:flex sm:w-8"
                          aria-hidden
                        >
                          <ArrowRight className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <label className="text-sm font-medium text-foreground" htmlFor="inv-to-st">
                            {inventoryT('transferTo', language)}
                          </label>
                          <select
                            id="inv-to-st"
                            className={selectClassName}
                            value={transferEndpointKey(toEndpoint)}
                            onChange={e => setToEndpoint(parseTransferEndpointKey(e.target.value))}
                          >
                            <option value="">{inventoryT('toPlaceholder', language)}</option>
                            {renderTransferEndpointOptions(
                              transferStationsOrdered,
                              activePondsOrdered,
                              aquacultureEnabled,
                              fromEndpoint,
                              userHomeStation,
                              'to',
                              language,
                            )}
                          </select>
                          <p className="text-xs text-muted-foreground">
                            {inventoryT('transferToHint', language)}
                          </p>
                        </div>
                      </div>
                      <div className="border-t border-border/50 pt-3">
                        <h3 id="inv-doc-heading" className="sr-only">
                          {inventoryT('documentDetails', language)}
                        </h3>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {transferRoute === 'station-station' ||
                          editingInterStationTransferId != null ||
                          amendingPostedTransferId != null ? (
                            <div className="space-y-1">
                              <label className="text-sm font-medium" htmlFor="inv-transfer-date">
                                {inventoryT('date', language)}
                              </label>
                              <input
                                id="inv-transfer-date"
                                type="date"
                                className={inputClassName}
                                value={transferDate}
                                onChange={e => setTransferDate(e.target.value)}
                              />
                            </div>
                          ) : null}
                          <div className="space-y-1 sm:col-span-2">
                            <label className="text-sm font-medium" htmlFor="inv-transfer-memo">
                              {inventoryT('memo', language)}{' '}
                              <span className="font-normal text-muted-foreground">{inventoryT('memoOptional', language)}</span>
                            </label>
                            <textarea
                              id="inv-transfer-memo"
                              rows={2}
                              className={inputClassName + ' min-h-[60px] resize-y py-2'}
                              value={transferMemo}
                              onChange={e => setTransferMemo(e.target.value)}
                              placeholder={inventoryT('memoPlaceholder', language)}
                            />
                          </div>
                        </div>
                      </div>
                    </section>

                    <section aria-labelledby="inv-lines-heading">
                      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                        <h3
                          id="inv-lines-heading"
                          className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          <Package className="h-3.5 w-3.5" aria-hidden />
                          {inventoryT('lineItems', language)}
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className={btnSecondary + ' !py-1.5 !text-xs'}
                            onClick={() => refreshLineAvailability()}
                            disabled={!lineItemIdsKey}
                          >
                            {inventoryT('refreshQuantitiesBtn', language)}
                          </button>
                          <button type="button" className={btnSecondary + ' !py-1.5 !text-xs'} onClick={addLineRow}>
                            <Plus className="h-3.5 w-3.5" />
                            {inventoryT('addLine', language)}
                          </button>
                        </div>
                      </div>

                      <div className="overflow-x-auto rounded-lg border border-border">
                        <table className="w-full min-w-[920px] text-sm">
                          <thead>
                            <tr className="border-b bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              <th className="w-10 px-3 py-2.5">#</th>
                              <th className="min-w-[200px] px-3 py-2.5">{inventoryT('product', language)}</th>
                              <th className="min-w-[100px] px-3 py-2.5">{inventoryT('sku', language)}</th>
                              <th className="min-w-[128px] px-3 py-2.5 text-right">{inventoryT('sourceOnHand', language)}</th>
                              <th className="min-w-[128px] px-3 py-2.5 text-right">{inventoryT('destOnHand', language)}</th>
                              <th className="min-w-[100px] px-3 py-2.5 text-right">{inventoryT('transferQty', language)}</th>
                              <th className="min-w-[148px] px-3 py-2.5 text-right">{inventoryT('actions', language)}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lineRows.map((row, i) => {
                              const product = catalogItems.find(p => p.id === row.item_id)
                              const st = row.item_id > 0 ? itemAvail[row.item_id] : undefined
                              const qVal = parseQtyInput(row.quantity)
                              let availMain: ReactNode = (
                                <span className="text-muted-foreground">—</span>
                              )
                              let availSub: ReactNode = null
                              let destMain: ReactNode = (
                                <span className="text-muted-foreground">—</span>
                              )
                              let destSub: ReactNode = null
                              let rowWarn = false

                              if (row.item_id <= 0) {
                                availMain = <span className="text-muted-foreground">{inventoryT('chooseProduct', language)}</span>
                                destMain = <span className="text-muted-foreground">—</span>
                              } else if (!fromEndpoint) {
                                availMain = (
                                  <span className="text-xs text-muted-foreground">{inventoryT('selectSendFromFirst', language)}</span>
                                )
                              } else if (!toEndpoint) {
                                destMain = (
                                  <span className="text-xs text-muted-foreground">{inventoryT('selectDestFirst', language)}</span>
                                )
                              }

                              if (
                                row.item_id > 0 &&
                                fromEndpoint &&
                                st?.status === 'ok' &&
                                st.data.tracks_per_station
                              ) {
                                const { qtyNum, unit } = qtyAtSourceEndpoint(st.data, fromEndpoint)
                                const others = sumQtySameItemOtherLines(lineRows, row.item_id, i)
                                const maxLine = Math.max(0, qtyNum - others)
                                availMain = (
                                  <span className="tabular-nums">
                                    <span className="font-semibold text-foreground">
                                      {qtyNum.toLocaleString(undefined, {
                                        maximumFractionDigits: 6,
                                      })}
                                    </span>{' '}
                                    <span className="text-muted-foreground">{unit}</span>
                                  </span>
                                )
                                if (qtyNum <= 0) {
                                  availSub = (
                                    <span className="mt-0.5 block text-xs text-amber-800 dark:text-amber-200">
                                      {inventoryT('noStockAtSource', language)}
                                    </span>
                                  )
                                  rowWarn = true
                                } else if (others > 0) {
                                  availSub = (
                                    <span className="mt-0.5 block text-xs text-muted-foreground">
                                      {inventoryT('maxThisLine', language)}{' '}
                                      <span className="font-medium text-foreground">
                                        {maxLine.toLocaleString(undefined, { maximumFractionDigits: 6 })} {unit}
                                      </span>
                                    </span>
                                  )
                                }
                                if (Number.isFinite(qVal) && qVal > maxLine + 1e-9) rowWarn = true
                                if (Number.isFinite(qVal) && qVal <= 0 && row.item_id > 0) rowWarn = true
                              } else if (row.item_id > 0 && fromEndpoint) {
                                if (!st || st.status === 'loading') {
                                  availMain = (
                                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      {inventoryT('loading', language)}
                                    </span>
                                  )
                                } else if (st.status === 'error') {
                                  availMain = <span className="text-xs text-destructive">{st.message}</span>
                                  rowWarn = true
                                } else if (st.status !== 'ok') {
                                  availMain = (
                                    <span className="text-xs text-muted-foreground">
                                      {inventoryT('refreshQuantities', language)}
                                    </span>
                                  )
                                } else if (!st.data.tracks_per_station) {
                                  availMain = (
                                    <span className="text-xs text-amber-800 dark:text-amber-200">
                                      {inventoryT('notMovable', language)}
                                    </span>
                                  )
                                  rowWarn = true
                                }
                              }

                              if (
                                row.item_id > 0 &&
                                toEndpoint &&
                                st?.status === 'ok' &&
                                st.data.tracks_per_station
                              ) {
                                const { qtyNum: destQty, unit: destUnit } = qtyAtDestinationEndpoint(
                                  st.data,
                                  toEndpoint,
                                )
                                destMain = (
                                  <span className="tabular-nums">
                                    <span className="font-semibold text-foreground">
                                      {destQty.toLocaleString(undefined, {
                                        maximumFractionDigits: 6,
                                      })}
                                    </span>{' '}
                                    <span className="text-muted-foreground">{destUnit}</span>
                                  </span>
                                )
                                if (Number.isFinite(qVal) && qVal > 0) {
                                  destSub = (
                                    <span className="mt-0.5 block text-xs text-muted-foreground">
                                      {inventoryT('afterMove', language)}{' '}
                                      <span className="font-medium text-foreground">
                                        {(destQty + qVal).toLocaleString(undefined, {
                                          maximumFractionDigits: 6,
                                        })}{' '}
                                        {destUnit}
                                      </span>
                                    </span>
                                  )
                                }
                              }

                              return (
                                <tr
                                  key={`inv-line-${i}`}
                                  className={`border-t border-border ${rowWarn ? 'bg-amber-500/5 dark:bg-amber-500/10' : ''}`}
                                >
                                  <td className="px-3 py-2.5 align-top text-muted-foreground tabular-nums">{i + 1}</td>
                                  <td className="px-3 py-2.5 align-top">
                                    <label className="sr-only" htmlFor={`tli-${i}`}>
                                      {inventoryT('productLine', language, { n: i + 1 })}
                                    </label>
                                    <CatalogItemCombobox
                                      id={`tli-${i}`}
                                      value={row.item_id > 0 ? row.item_id : ''}
                                      onChange={id =>
                                        updateLine(
                                          i,
                                          'item_id',
                                          typeof id === 'number' ? id : 0,
                                        )
                                      }
                                      items={catalogItems}
                                      emptyLabel={inventoryT('selectProductPh', language)}
                                      placeholder={inventoryT('searchProducts', language)}
                                      className={selectClassName}
                                    />
                                  </td>
                                  <td className="px-3 py-2.5 align-top text-muted-foreground tabular-nums">
                                    {product?.item_number || '—'}
                                  </td>
                                  <td className="px-3 py-2.5 align-top text-right">
                                    <div>{availMain}</div>
                                    {availSub}
                                  </td>
                                  <td className="px-3 py-2.5 align-top text-right">
                                    <div>{destMain}</div>
                                    {destSub}
                                  </td>
                                  <td className="px-3 py-2.5 align-top text-right">
                                    <label className="sr-only" htmlFor={`tlq-${i}`}>
                                      {inventoryT('quantityLine', language, { n: i + 1 })}
                                    </label>
                                    <input
                                      id={`tlq-${i}`}
                                      className={inputClassName + ' text-right tabular-nums'}
                                      inputMode="decimal"
                                      autoComplete="off"
                                      placeholder={inventoryT('enterQty', language)}
                                      value={row.quantity}
                                      onChange={e => updateLine(i, 'quantity', e.target.value)}
                                      aria-invalid={rowWarn}
                                    />
                                  </td>
                                  <td className="px-3 py-2.5 align-top">
                                    <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
                                      <button
                                        type="button"
                                        className={
                                          btnSecondary +
                                          ' !w-full !justify-center !px-2.5 !py-1.5 !text-xs sm:!w-auto'
                                        }
                                        disabled={
                                          saving ||
                                          (row.item_id <= 0 &&
                                            !String(row.quantity).trim() &&
                                            !fromEndpoint &&
                                            !toEndpoint)
                                        }
                                        title={inventoryT('clearLineTitle', language)}
                                        onClick={() => clearLineRow(i)}
                                      >
                                        <RotateCcw className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                        {inventoryT('clear', language)}
                                      </button>
                                      {fromEndpoint &&
                                      row.item_id > 0 &&
                                      st?.status === 'ok' &&
                                      st.data.tracks_per_station ? (
                                        <button
                                          type="button"
                                          className={
                                            btnSecondary +
                                            ' !w-full !justify-center !px-2.5 !py-1.5 !text-xs sm:!w-auto'
                                          }
                                          disabled={saving}
                                          onClick={() => applyMaxQty(i)}
                                        >
                                          {inventoryT('useMaxQty', language)}
                                        </button>
                                      ) : null}
                                      {lineRows.length > 1 ? (
                                        <button
                                          type="button"
                                          aria-label={`Remove line ${i + 1}`}
                                          title={inventoryT('removeLineTitle', language)}
                                          className={btnDanger + ' !w-full !justify-center !py-1.5 !text-xs sm:!w-auto'}
                                          disabled={saving}
                                          onClick={() => removeLine(i)}
                                        >
                                          <Trash2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                          {inventoryT('removeLine', language)}
                                        </button>
                                      ) : null}
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>

                      {transferDraftIssues.length > 0 && (
                        <div
                          className="mt-4 rounded-lg border border-amber-200/90 bg-amber-50/90 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/25"
                          role="status"
                        >
                          <div className="flex gap-2">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
                            <ul className="list-inside list-disc space-y-1 text-sm text-amber-950 dark:text-amber-100">
                              {transferDraftIssues.map((msg, idx) => (
                                <li key={idx}>{msg}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}

                      <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
                        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                          {inventoryT('formFooterHint', language)}
                        </p>
                        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
                          {editingInterStationTransferId != null ||
                          amendingPostedTransferId != null ||
                          editingPondReceiptId != null ? (
                            <button
                              type="button"
                              className={btnSecondary + ' w-full shrink-0 sm:w-auto'}
                              disabled={saving}
                              onClick={() => cancelEditInterStationDraft()}
                            >
                              {inventoryT('cancelEdit', language)}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={btnPrimary + ' w-full shrink-0 sm:w-auto'}
                            disabled={saving || transferDraftIssues.length > 0}
                            onClick={() => void submitTransferDraft()}
                          >
                            {saving ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Package className="h-4 w-4" />
                            )}
                            {editingPondReceiptId != null
                              ? inventoryT('saveUpdateLocations', language)
                              : amendingPostedTransferId != null
                                ? inventoryT('saveUpdateSites', language)
                                : editingInterStationTransferId != null
                                  ? inventoryT('saveChanges', language)
                                : transferRoute === 'station-station'
                                  ? inventoryT('saveDraft', language)
                                : transferRoute === 'station-pond'
                                  ? inventoryT('moveToPondWarehouse', language)
                                  : transferRoute === 'pond-station'
                                    ? inventoryT('returnToShop', language)
                                  : transferRoute === 'pond-pond'
                                    ? inventoryT('moveBetweenPonds', language)
                                    : inventoryT('saveTransfer', language)}
                          </button>
                        </div>
                      </div>
                    </section>
                  </div>
                </div>
              )}

              <div className="w-full min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm ring-1 ring-black/5 dark:ring-white/5">
                <div className="border-b border-border bg-muted/30 px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                      <h2 className="text-base font-semibold tracking-tight">{inventoryT('interStationTransfers', language)}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {inventoryT('interStationHint', language)}
                        {userHomeStation
                          ? inventoryT('filteredTo', language, { site: userHomeStation.name })
                          : ''}
                      </p>
                    </div>
                    <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
                      <div className="relative min-w-0 flex-1 sm:min-w-[220px]">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <input
                          type="search"
                          placeholder={inventoryT('searchTransfers', language)}
                          value={transferSearch}
                          onChange={e => setTransferSearch(e.target.value)}
                          className={inputClassName + ' pl-9'}
                        />
                      </div>
                      <select
                        className={selectClassName + ' sm:w-[140px]'}
                        value={transferStatusFilter}
                        onChange={e =>
                          setTransferStatusFilter(e.target.value as 'all' | 'draft' | 'posted')
                        }
                        aria-label={inventoryT('filterByStatus', language)}
                      >
                        <option value="all">{inventoryT('allStatuses', language)}</option>
                        <option value="draft">{inventoryT('draft', language)}</option>
                        <option value="posted">{inventoryT('posted', language)}</option>
                      </select>
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] text-sm">
                    <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2.5">#</th>
                        <th className="px-4 py-2.5">{inventoryT('date', language)}</th>
                        <th className="px-4 py-2.5">{inventoryT('route', language)}</th>
                        <th className="px-4 py-2.5">{inventoryT('status', language)}</th>
                        <th className="px-4 py-2.5">{inventoryT('lines', language)}</th>
                        <th className="px-4 py-2.5 text-right">{inventoryT('value', language)}</th>
                        <th className="px-4 py-2.5 text-right whitespace-nowrap">{inventoryT('actions', language)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTransfers.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-4 py-12 text-center">
                            <div className="mx-auto max-w-sm">
                              <ArrowRightLeft className="mx-auto h-8 w-8 text-muted-foreground/50" />
                              <p className="mt-3 font-medium text-foreground">
                                {transfers.length === 0
                                  ? inventoryT('noTransfersYet', language)
                                  : inventoryT('noMatchingTransfers', language)}
                              </p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {transfers.length === 0
                                  ? inventoryT('noTransfersHint', language)
                                  : inventoryT('noTransfersFilterHint', language)}
                              </p>
                            </div>
                          </td>
                        </tr>
                      ) : (
                        filteredTransfers.map(t => (
                          <tr key={t.id} className="border-t border-border/80 transition-colors hover:bg-muted/30">
                            <td className="px-4 py-3 font-mono text-xs">
                              {t.transfer_number || `TR-${t.id}`}
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              {formatDateOnly(t.transfer_date)}
                            </td>
                            <td className="px-4 py-3">
                              <span className="font-medium">{t.from_station_name || t.from_station_id}</span>
                              <span className="mx-1.5 text-muted-foreground">→</span>
                              <span>{t.to_station_name || t.to_station_id}</span>
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                  t.status === 'posted'
                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'
                                    : 'bg-amber-100 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200'
                                }`}
                                title={interStationTransferImpactSummary(t, language)}
                              >
                                {t.status === 'posted'
                                  ? inventoryT('posted', language)
                                  : inventoryT('draft', language)}
                              </span>
                            </td>
                            <td className="max-w-xs px-4 py-3 text-muted-foreground">
                              <span className="line-clamp-2">
                                {t.lines?.map(l => `${l.item_name} (${l.quantity})`).join(' · ') || '—'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap font-medium">
                              {formatInventoryValue(t.total_value, currencySymbol)}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {t.status === 'draft' ? (
                                <div className="flex flex-wrap items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    className={btnRowIconMuted}
                                    disabled={transferListBusy}
                                    title={inventoryT('viewTransferDetails', language)}
                                    aria-label={`View draft ${t.transfer_number || t.id}`}
                                    onClick={() => setViewTransfer(t)}
                                  >
                                    <Eye className="h-5 w-5 shrink-0" aria-hidden />
                                  </button>
                                  {canCreateSiteTransfer ? (
                                    <button
                                      type="button"
                                      className={btnRowIconMuted}
                                      disabled={transferListBusy || saving}
                                      title={inventoryT('editDraftInForm', language)}
                                      aria-label={`Edit draft ${t.transfer_number || t.id}`}
                                      onClick={() => startEditInterStationDraft(t)}
                                    >
                                      <Pencil className="h-5 w-5 shrink-0" aria-hidden />
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className={btnRowIconPrimary}
                                    disabled={transferListBusy}
                                    title={interStationTransferImpactSummary(t, language)}
                                    aria-label={`Post transfer ${t.transfer_number || t.id}`}
                                    onClick={() =>
                                      setConfirmAction({
                                        kind: 'post',
                                        id: t.id,
                                        label: t.transfer_number || `TR-${t.id}`,
                                      })
                                    }
                                  >
                                    {transferPostingId === t.id ? (
                                      <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
                                    ) : (
                                      <Check className="h-5 w-5 shrink-0" aria-hidden />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    className={btnRowIconDanger}
                                    disabled={transferListBusy}
                                    title={inventoryT('deleteDraftTitle', language)}
                                    aria-label={`Delete draft ${t.transfer_number || t.id}`}
                                    onClick={() =>
                                      setConfirmAction({
                                        kind: 'delete',
                                        id: t.id,
                                        label: t.transfer_number || `TR-${t.id}`,
                                      })
                                    }
                                  >
                                    {transferDeletingId === t.id ? (
                                      <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
                                    ) : (
                                      <Trash2 className="h-5 w-5 shrink-0" aria-hidden />
                                    )}
                                  </button>
                                </div>
                              ) : (
                                <div className="flex flex-wrap items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    className={btnRowIconMuted}
                                    disabled={transferListBusy}
                                    title={inventoryT('viewTransferDetails', language)}
                                    aria-label={`View posted transfer ${t.transfer_number || t.id}`}
                                    onClick={() => setViewTransfer(t)}
                                  >
                                    <Eye className="h-5 w-5 shrink-0" aria-hidden />
                                  </button>
                                  {canCreateSiteTransfer ? (
                                    <button
                                      type="button"
                                      className={btnRowIconMuted}
                                      disabled={transferListBusy || saving}
                                      title={inventoryT('editPostedHint', language)}
                                      aria-label={`Edit posted transfer ${t.transfer_number || t.id}`}
                                      onClick={() => startAmendPostedTransfer(t)}
                                    >
                                      <Pencil className="h-5 w-5 shrink-0" aria-hidden />
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className={btnRowIconWarning}
                                    disabled={transferListBusy}
                                    title={interStationTransferImpactSummary(t, language)}
                                    aria-label={`Roll back posted transfer ${t.transfer_number || t.id}`}
                                    onClick={() =>
                                      setConfirmAction({
                                        kind: 'unpost',
                                        id: t.id,
                                        label: t.transfer_number || `TR-${t.id}`,
                                      })
                                    }
                                  >
                                    {transferUnpostingId === t.id ? (
                                      <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
                                    ) : (
                                      <Undo2 className="h-5 w-5 shrink-0" aria-hidden />
                                    )}
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {pondReceipts.length > 0 || canMoveToPondWarehouse ? (
                <div className="w-full min-w-0 overflow-hidden rounded-2xl border border-border bg-card shadow-sm ring-1 ring-black/5 dark:ring-white/5">
                  <div className="border-b border-border bg-muted/30 px-4 py-4 sm:px-5">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                      <div>
                        <h2 className="text-base font-semibold tracking-tight">{inventoryT('shopPondWarehouse', language)}</h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {inventoryT('shopPondHint', language)}
                        </p>
                      </div>
                      <div className="relative w-full sm:max-w-xs">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <input
                          type="search"
                          placeholder={inventoryT('searchMoves', language)}
                          value={pondReceiptSearch}
                          onChange={e => setPondReceiptSearch(e.target.value)}
                          className={inputClassName + ' pl-9'}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[780px] text-sm">
                      <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-4 py-2.5">#</th>
                          <th className="px-4 py-2.5">{inventoryT('when', language)}</th>
                          <th className="px-4 py-2.5">{inventoryT('route', language)}</th>
                          <th className="px-4 py-2.5">{inventoryT('lines', language)}</th>
                          <th className="px-4 py-2.5 text-right">{inventoryT('value', language)}</th>
                          <th className="px-4 py-2.5 text-right whitespace-nowrap">{inventoryT('actions', language)}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPondReceipts.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-4 py-12 text-center">
                              <div className="mx-auto max-w-sm">
                                <Sprout className="mx-auto h-8 w-8 text-muted-foreground/50" />
                                <p className="mt-3 font-medium text-foreground">
                                  {pondReceipts.length === 0
                                    ? inventoryT('noPondMovesYet', language)
                                    : inventoryT('noMatchingReceipts', language)}
                                </p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {inventoryT('pondMovesHint', language)}
                                </p>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          filteredPondReceipts.map(r => (
                            <tr
                              key={`${r.movement_type || 'shop_to_pond'}-${r.id}`}
                              className="border-t border-border/80 transition-colors hover:bg-muted/30"
                            >
                              <td className="px-4 py-3 font-mono text-xs">
                                {pondMovementDocNumber(r)}
                              </td>
                              <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                                {r.created_at ? formatDateOnly(r.created_at) : '—'}
                              </td>
                              <td className="px-4 py-3">
                                {pondMovementIsReturn(r) ? (
                                  <>
                                    <Link
                                      href={`/aquaculture/ponds/${r.pond_id}`}
                                      className="font-medium text-primary underline-offset-2 hover:underline"
                                    >
                                      {r.pond_name || inventoryT('pondNum', language, { id: r.pond_id })}
                                    </Link>
                                    <span className="mx-1.5 text-muted-foreground">→</span>
                                    <span className="font-medium">
                                      {r.to_station_name || r.to_station_id || inventoryT('shop', language)}
                                    </span>
                                  </>
                                ) : (
                                  <>
                                    <span className="font-medium">
                                      {r.from_station_name || r.from_station_id}
                                    </span>
                                    <span className="mx-1.5 text-muted-foreground">→</span>
                                    <Link
                                      href={`/aquaculture/ponds/${r.pond_id}`}
                                      className="font-medium text-primary underline-offset-2 hover:underline"
                                    >
                                      {r.pond_name || inventoryT('pondNum', language, { id: r.pond_id })}
                                    </Link>
                                  </>
                                )}
                              </td>
                              <td className="max-w-xs px-4 py-3 text-muted-foreground">
                                <span className="line-clamp-2">
                                  {r.lines?.map(l => `${l.item_name} (${l.quantity})`).join(' · ') || '—'}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap font-medium">
                                {formatInventoryValue(r.total_value, currencySymbol)}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex flex-wrap items-center justify-end gap-1.5">
                                  <button
                                    type="button"
                                    className={btnRowIconMuted}
                                    disabled={transferListBusy}
                                    title={inventoryT('viewReceiptDetails', language)}
                                    aria-label={`View pond receipt ${r.receipt_number || r.id}`}
                                    onClick={() => setViewPondReceipt(r)}
                                  >
                                    <Eye className="h-5 w-5 shrink-0" aria-hidden />
                                  </button>
                                  {canMoveToPondWarehouse && !pondMovementIsReturn(r) ? (
                                    <button
                                      type="button"
                                      className={btnRowIconMuted}
                                      disabled={transferListBusy || saving}
                                      title={inventoryT('editReceiptTitle', language)}
                                      aria-label={`Edit pond receipt ${pondMovementDocNumber(r)}`}
                                      onClick={() => startEditPondReceipt(r)}
                                    >
                                      <Pencil className="h-5 w-5 shrink-0" aria-hidden />
                                    </button>
                                  ) : null}
                                  <button
                                    type="button"
                                    className={btnRowIconDanger}
                                    disabled={transferListBusy}
                                    title={
                                      pondMovementIsReturn(r)
                                        ? pondWarehouseReturnImpactSummary(language)
                                        : pondWarehouseReceiptImpactSummary(language)
                                    }
                                    aria-label={`Reverse ${pondMovementDocNumber(r)}`}
                                    onClick={() =>
                                      setConfirmAction({
                                        kind: 'reverse',
                                        id: r.id,
                                        label: pondMovementDocNumber(r),
                                        movementType: r.movement_type || 'shop_to_pond',
                                      })
                                    }
                                  >
                                    {pondReceiptReversingId === r.id ? (
                                      <Loader2 className="h-5 w-5 shrink-0 animate-spin" aria-hidden />
                                    ) : (
                                      <Trash2 className="h-5 w-5 shrink-0" aria-hidden />
                                    )}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          )}
            </div>
          </div>
        </div>
      </div>

      <Modal
        isOpen={viewTransfer != null}
        onClose={() => setViewTransfer(null)}
        title={viewTransfer ? viewTransfer.transfer_number || `TR-${viewTransfer.id}` : inventoryT('transfer', language)}
        size="md"
      >
        {viewTransfer ? (
          <div className="space-y-4 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">{inventoryT('status', language)}</p>
                <p className="font-medium capitalize">
                  {viewTransfer.status === 'posted'
                    ? inventoryT('posted', language)
                    : inventoryT('draft', language)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase text-muted-foreground">{inventoryT('date', language)}</p>
                <p>{formatDateOnly(viewTransfer.transfer_date)}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs font-medium uppercase text-muted-foreground">{inventoryT('route', language)}</p>
                <p>
                  {viewTransfer.from_station_name || viewTransfer.from_station_id}
                  <span className="mx-1.5 text-muted-foreground">→</span>
                  {viewTransfer.to_station_name || viewTransfer.to_station_id}
                </p>
              </div>
              {viewTransfer.auto_journal_entry_number ? (
                <div className="sm:col-span-2">
                  <p className="text-xs font-medium uppercase text-muted-foreground">{inventoryT('journal', language)}</p>
                  <p className="font-mono text-xs">{viewTransfer.auto_journal_entry_number}</p>
                </div>
              ) : null}
              {viewTransfer.memo ? (
                <div className="sm:col-span-2">
                  <p className="text-xs font-medium uppercase text-muted-foreground">{inventoryT('memo', language)}</p>
                  <p>{viewTransfer.memo}</p>
                </div>
              ) : null}
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">{inventoryT('lines', language)}</p>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {(viewTransfer.lines || []).map(ln => (
                  <li key={ln.id ?? `${ln.item_id}-${ln.quantity}`} className="flex justify-between gap-3 px-3 py-2">
                    <span>{ln.item_name || inventoryT('itemNum', language, { id: ln.item_id })}</span>
                    <span className="text-right tabular-nums">
                      <span className="font-medium">{ln.quantity}</span>
                      {ln.line_value ? (
                        <span className="ml-2 text-muted-foreground">
                          {formatInventoryValue(ln.line_value, currencySymbol)}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              {viewTransfer.total_value ? (
                <p className="mt-2 text-right text-sm font-semibold tabular-nums">
                  {inventoryT('total', language)} {formatInventoryValue(viewTransfer.total_value, currencySymbol)}
                </p>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">{interStationTransferImpactSummary(viewTransfer, language)}</p>
          </div>
        ) : null}
      </Modal>

      <Modal
        isOpen={viewPondReceipt != null}
        onClose={() => setViewPondReceipt(null)}
        title={viewPondReceipt ? viewPondReceipt.receipt_number || `PWR-${viewPondReceipt.id}` : inventoryT('pondReceipt', language)}
        size="md"
      >
        {viewPondReceipt ? (
          <div className="space-y-4 text-sm">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">{inventoryT('when', language)}</p>
              <p>{viewPondReceipt.created_at ? formatDateOnly(viewPondReceipt.created_at) : '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Route</p>
              <p>
                {viewPondReceipt.from_station_name || viewPondReceipt.from_station_id}
                <span className="mx-1.5 text-muted-foreground">→</span>
                {viewPondReceipt.pond_name || inventoryT('pondNum', language, { id: viewPondReceipt.pond_id })}
              </p>
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase text-muted-foreground">{inventoryT('lines', language)}</p>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {(viewPondReceipt.lines || []).map(ln => (
                  <li
                    key={`${ln.item_id}-${ln.quantity}`}
                    className="flex justify-between gap-3 px-3 py-2"
                  >
                    <span>{ln.item_name || inventoryT('itemNum', language, { id: ln.item_id })}</span>
                    <span className="text-right tabular-nums">
                      <span className="font-medium">{ln.quantity}</span>
                      {ln.line_value ? (
                        <span className="ml-2 text-muted-foreground">
                          {formatInventoryValue(ln.line_value, currencySymbol)}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              {viewPondReceipt.total_value ? (
                <p className="mt-2 text-right text-sm font-semibold tabular-nums">
                  {inventoryT('total', language)} {formatInventoryValue(viewPondReceipt.total_value, currencySymbol)}
                </p>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground">{pondWarehouseReceiptImpactSummary(language)}</p>
          </div>
        ) : null}
      </Modal>

      <Modal
        isOpen={confirmAction != null}
        onClose={() => {
          if (!confirmBusy) setConfirmAction(null)
        }}
        title={confirmCopy.title}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            {confirmCopy.body}
            {confirmAction ? (
              <span className="mt-2 block font-medium text-gray-900">{confirmAction.label}</span>
            ) : null}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              className={btnSecondary + ' w-full sm:w-auto'}
              disabled={confirmBusy}
              onClick={() => setConfirmAction(null)}
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              className={
                (confirmCopy.danger ? btnDanger : btnPrimary) + ' w-full sm:w-auto !px-4 !py-2.5'
              }
              disabled={confirmBusy}
              onClick={() => void runConfirmAction()}
            >
              {confirmBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {confirmCopy.confirmLabel}
            </button>
          </div>
        </div>
      </Modal>
    </PageLayout>
  )
}

function InventoryLoadingFallback() {
  const { language } = useCompanyLocale()
  return (
    <PageLayout className="bg-slate-50">
      <div className="flex min-h-[50vh] items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-10 py-12 text-center shadow-sm">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm font-medium text-foreground">{inventoryT('loadingInventory', language)}…</p>
        </div>
      </div>
    </PageLayout>
  )
}

export default function InventoryPage() {
  return (
    <Suspense fallback={<InventoryLoadingFallback />}>
      <InventoryContent />
    </Suspense>
  )
}
