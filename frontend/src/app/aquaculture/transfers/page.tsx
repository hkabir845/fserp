'use client'

import { CompanyDateInput } from '@/components/CompanyDateInput'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, ArrowRightLeft, Beaker, FileBarChart, Fish, Plus, RefreshCw, Trash2, Pencil } from 'lucide-react'
import { AquaculturePageShell } from '@/components/aquaculture/AquaculturePageShell'
import { AQ_HERO_BTN_GHOST, AQ_HERO_BTN_PRIMARY } from '@/components/aquaculture/AquacultureUi'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatDateOnly } from '@/utils/date'
import { formatNumber, getCurrencySymbol, roundToDecimals } from '@/utils/currency'
import { roundCountInputString, roundDecimalInputString } from '@/utils/inputDecimals'
import { growOutPondsForTransfers, sameSiteGrowOutPond } from '@/lib/aquaculturePondSite'
import { aquacultureT, aquacultureTFormat, nursingWorkflowSteps } from '@/lib/aquacultureI18n'
import { MODAL_FORM_SCROLL } from '@/lib/modalLayout'
import { useT } from '@/lib/i18n'
import { usePageMeta } from '@/hooks/usePageMeta'

const SAMPLE_STALE_DAYS = 30

interface Pond {
  id: number
  name: string
  pond_role?: string
  pond_role_label?: string
  physical_site_name?: string
  is_active?: boolean
  same_site_grow_out_pond_id?: number | null
  same_site_grow_out_display_name?: string
  linked_grow_out_pond_id?: number | null
  linked_grow_out_pond_name?: string
  operational_display_name?: string
  phase_workflow_summary?: string
}

interface CycleRow {
  id: number
  name: string
  code?: string
  pond_id: number
  start_date?: string
  end_date?: string | null
  is_active?: boolean
  source_production_cycle_id?: number | null
  fry_stocking_date?: string | null
  fry_stocking_fish_count?: number | null
}

interface TransferCostPreviewLine {
  cost_amount: string | null
}

interface TransferCostPreviewResponse {
  cost_basis: 'per_kg' | 'per_head'
  live_fingerling_count?: number | null
  stocked_fingerling_count?: number | null
  stocked_heads_basis?: number | null
  movable_bio_asset_total?: string | null
  implied_net_weight_kg?: string | null
  effective_net_weight_kg?: string | null
  current_fish_per_kg?: string | null
  current_avg_weight_kg?: string | null
  pond_cost_per_fish?: string | null
  pond_cost_per_kg?: string | null
  stock_density_kg_per_decimal?: string | null
  transfer_cost_per_kg?: string | null
  transfer_cost_per_head?: string | null
  transfer_cost_basis_note?: string | null
  lines: TransferCostPreviewLine[]
}

interface TransferLine {
  id: number
  to_pond_id: number
  to_pond_name: string
  to_production_cycle_id: number | null
  to_production_cycle_name: string
  weight_kg: string
  fish_count: number | null
  pcs_per_kg: string | null
  cost_amount: string
  fry_cost_amount?: string
  other_expense_amount?: string
}

interface TransferRow {
  id: number
  from_pond_id: number
  from_pond_name: string
  from_production_cycle_id: number | null
  from_production_cycle_name: string
  transfer_date: string
  fish_species: string
  fish_species_label: string
  fish_species_other?: string
  memo: string
  lines: TransferLine[]
  fry_cost_total?: string
  other_expense_total?: string
  cost_total?: string
  gl_posted?: boolean
  journal_entry_number?: string | null
  gl_total_amount?: string | null
}

interface GlSyncPayload {
  posted?: boolean
  reason?: string
  total_gl_amount?: string
  total_requested?: string
  gl_capped?: boolean
  gl_cap_note?: string | null
  journal_entry_number?: string | null
}

function transferOutboundFromSource(
  t: TransferRow,
  sourcePondId: number,
  sourceCycleId: string
): { heads: number; kg: number } {
  if (t.from_pond_id !== sourcePondId) return { heads: 0, kg: 0 }
  if (sourceCycleId.trim() !== '') {
    const cy = parseInt(sourceCycleId, 10)
    if (!Number.isFinite(cy) || t.from_production_cycle_id !== cy) return { heads: 0, kg: 0 }
  }
  let heads = 0
  let kg = 0
  for (const l of t.lines) {
    heads += l.fish_count != null ? Number(l.fish_count) : 0
    kg += Number.parseFloat(l.weight_kg) || 0
  }
  return { heads, kg }
}

function formatTransferGlMessage(
  glSync: GlSyncPayload | undefined,
  transfer: TransferRow | undefined,
  currencySymbol: string
): string {
  if (glSync?.posted) {
    const amt = glSync.total_gl_amount || transfer?.gl_total_amount
    const parts = ['GL 1581 posted']
    if (amt) parts.push(`${currencySymbol}${formatNumber(Number(amt), 2)}`)
    if (glSync.gl_capped) parts.push('(capped at source 1581 balance)')
    return parts.join(' · ')
  }
  if (glSync?.reason === 'source_pond_1581_balance_zero') {
    return 'GL not posted — source pond has no 1581 balance'
  }
  if (glSync?.reason === 'no_cost_amount') {
    return 'GL not posted — no transfer cost on lines'
  }
  return ''
}

type LineDraft = {
  to_pond_id: string
  to_production_cycle_id: string
  weight_kg: string
  fish_count: string
  pcs_per_kg: string
  cost_amount: string
}

type LastSampleReference = {
  sample_id: number
  sample_date: string
  pond_id?: number
  pond_name?: string
  production_cycle_id?: number | null
  production_cycle_name?: string
  fish_per_kg?: string | null
  fish_species_label?: string
  estimated_fish_count?: number | null
  estimated_total_weight_kg?: string | null
  stock_reference_fish_count?: number | null
  extrapolated_biomass_kg?: string | null
  cycle_scope_fallback?: boolean
  site_scope_fallback?: boolean
}

type SourceStockBrief = {
  implied_net_fish_count: number
  implied_net_weight_kg: string
  effective_net_weight_kg?: string
  current_fish_per_kg?: string | null
  current_avg_weight_kg?: string | null
  latest_sample_date?: string | null
  stock_density_kg_per_decimal?: string | null
}

const emptyLine = (): LineDraft => ({
  to_pond_id: '',
  to_production_cycle_id: '',
  weight_kg: '',
  fish_count: '',
  pcs_per_kg: '',
  cost_amount: '',
})

/** Format kg for the weight input (exactly 2 decimal places). */
function formatWeightKgFromCalc(w: number): string {
  if (!Number.isFinite(w) || w <= 0) return ''
  return roundDecimalInputString(String(w), 2)
}

/**
 * Keeps fish count, weight (kg), and pcs/kg in sync when two of the three are known.
 * - fish + pcs/kg → weight
 * - weight + pcs/kg → fish (rounded heads)
 * - pcs/kg change: if heads are filled, derive weight; else derive heads from weight.
 */
function recalcTransferLine(ln: LineDraft, source: 'fish' | 'weight' | 'pcs'): LineDraft {
  const pcsRaw = String(ln.pcs_per_kg).trim()
  const pcs = Number(pcsRaw)
  const pcsOk = Number.isFinite(pcs) && pcs > 0

  if (source === 'fish') {
    if (!pcsOk) return ln
    const fc = parseInt(String(ln.fish_count).trim(), 10)
    if (!Number.isFinite(fc) || fc <= 0) return ln
    return { ...ln, weight_kg: formatWeightKgFromCalc(fc / pcs) }
  }

  if (source === 'weight') {
    if (!pcsOk) return ln
    const w = Number(String(ln.weight_kg).trim())
    if (!Number.isFinite(w) || w <= 0) return ln
    const heads = Math.max(1, Math.round(w * pcs))
    return { ...ln, fish_count: String(heads) }
  }

  // pcs/kg edited
  const fc = parseInt(String(ln.fish_count).trim(), 10)
  const hasFish = Number.isFinite(fc) && fc > 0
  if (hasFish && pcsOk) {
    return { ...ln, weight_kg: formatWeightKgFromCalc(fc / pcs) }
  }
  const w = Number(String(ln.weight_kg).trim())
  const hasW = Number.isFinite(w) && w > 0
  if (hasW && pcsOk) {
    const heads = Math.max(1, Math.round(w * pcs))
    return { ...ln, fish_count: String(heads) }
  }
  return ln
}

/** Pre-fill pcs/kg from sampling when the line has not been manually overridden. */
function applyEffectivePcsToLine(
  ln: LineDraft,
  lineIdx: number,
  fishPerKg: string,
  skipAutoPcs: Set<number>,
): LineDraft {
  if (skipAutoPcs.has(lineIdx)) return ln
  const fpk = fishPerKg.trim()
  if (!fpk) return ln
  let next = { ...ln, pcs_per_kg: roundDecimalInputString(fpk, 2) }
  if (ln.fish_count.trim() !== '') {
    next = recalcTransferLine(next, 'fish')
  }
  return next
}

function daysSinceIsoDate(iso: string): number | null {
  const d = iso.slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null
  const then = new Date(`${d}T12:00:00`)
  const now = new Date()
  const ms = now.getTime() - then.getTime()
  if (!Number.isFinite(ms)) return null
  return Math.floor(ms / (24 * 60 * 60 * 1000))
}

const COST_PREVIEW_DEBOUNCE_MS = 350

export default function AquacultureFishTransfersPage() {
  const pageMeta = usePageMeta()
  const toast = useToast()
  const { lang, t: uiT, pick } = useT()
  const nursingSteps = useMemo(() => nursingWorkflowSteps(lang), [lang])
  const [ponds, setPonds] = useState<Pond[]>([])
  const [cycles, setCycles] = useState<CycleRow[]>([])
  const [species, setSpecies] = useState<{ id: string; label: string }[]>([])
  const [helpNote, setHelpNote] = useState('')
  const [rows, setRows] = useState<TransferRow[]>([])
  const [loading, setLoading] = useState(true)
  const [currency, setCurrency] = useState('BDT')
  const [modal, setModal] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  /** Snapshot when opening edit — used to add back outbound fish for stock checks (matches backend exclude_transfer_id). */
  const [editingOriginal, setEditingOriginal] = useState<TransferRow | null>(null)
  const [fromPondId, setFromPondId] = useState('')
  const [fromCycleId, setFromCycleId] = useState('')
  const [transferDate, setTransferDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [fishSpecies, setFishSpecies] = useState('tilapia')
  const [fishSpeciesOther, setFishSpeciesOther] = useState('')
  const [memo, setMemo] = useState('')
  const [lineDrafts, setLineDrafts] = useState<LineDraft[]>([emptyLine()])
  const [transferCostBasis, setTransferCostBasis] = useState<'per_kg' | 'per_head' | null>(null)
  const [transferCostPerKg, setTransferCostPerKg] = useState<number | null>(null)
  const [transferCostPerHead, setTransferCostPerHead] = useState<number | null>(null)
  const [transferCostPreviewLoading, setTransferCostPreviewLoading] = useState(false)
  const [transferPlBasisHint, setTransferPlBasisHint] = useState('')
  const [transferCostContext, setTransferCostContext] = useState<{
    liveFingerlingCount: number | null
    stockedFingerlingCount: number | null
    movableBioAssetTotal: number | null
    pondCostPerFish: number | null
  }>({
    liveFingerlingCount: null,
    stockedFingerlingCount: null,
    movableBioAssetTotal: null,
    pondCostPerFish: null,
  })
  const skipAutoCostLine = useRef<Set<number>>(new Set())
  const skipAutoPcsLine = useRef<Set<number>>(new Set())
  const autoCycleFromSampleDone = useRef(false)
  const costPreviewRequestId = useRef(0)
  const [costPreviewRevision, setCostPreviewRevision] = useState(0)
  const [lastSample, setLastSample] = useState<LastSampleReference | null>(null)
  const [lastSampleLoading, setLastSampleLoading] = useState(false)
  const [sourceStock, setSourceStock] = useState<SourceStockBrief | null>(null)
  const [sourceStockLoading, setSourceStockLoading] = useState(false)

  const lineCostPreviewKey = useMemo(
    () => lineDrafts.map((ln) => `${ln.weight_kg.trim()}|${ln.fish_count.trim()}`).join(';'),
    [lineDrafts],
  )

  const hasAutoTransferCostRate = transferCostBasis === 'per_head'
    ? transferCostPerHead != null
    : transferCostPerKg != null

  const loadPonds = useCallback(async () => {
    try {
      const [coRes, pondsRes] = await Promise.all([
        api.get<Record<string, unknown>>('/companies/current/'),
        api.get<Pond[]>('/aquaculture/ponds/'),
      ])
      setCurrency(String(coRes.data?.currency || 'BDT').slice(0, 3))
      setPonds(Array.isArray(pondsRes.data) ? pondsRes.data : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, aquacultureT('couldNotLoadPonds', lang)))
    }
  }, [toast, lang])

  const loadCycles = useCallback(async () => {
    try {
      const { data } = await api.get<CycleRow[]>('/aquaculture/production-cycles/')
      setCycles(Array.isArray(data) ? data : [])
    } catch {
      setCycles([])
    }
  }, [])

  /** Fry/nursing cohort batches for source pond (excludes grow-out batches linked from nursing). */
  const nursingCohortCycles = useCallback(
    (pondIdStr: string) => {
      const pid = parseInt(pondIdStr, 10)
      if (!Number.isFinite(pid)) return []
      return cycles
        .filter(
          (c) =>
            c.pond_id === pid &&
            c.is_active !== false &&
            (c.source_production_cycle_id == null || c.source_production_cycle_id === 0),
        )
        .sort((a, b) => {
          const ca = (a.code || '').trim()
          const cb = (b.code || '').trim()
          if (ca && cb && ca !== cb) return ca.localeCompare(cb, undefined, { numeric: true })
          const da = a.fry_stocking_date || a.start_date || ''
          const db = b.fry_stocking_date || b.start_date || ''
          if (da !== db) return db.localeCompare(da)
          return b.id - a.id
        })
    },
    [cycles],
  )

  const formatCycleOptionLabel = (c: CycleRow) => {
    const code = (c.code || '').trim()
    const started = c.fry_stocking_date || c.start_date
    const startedLabel = started ? formatDateOnly(started) : ''
    const bits = [code || c.name || `Batch ${c.id}`]
    if (code && c.name && c.name !== code) bits.push(c.name)
    if (c.fry_stocking_fish_count != null && c.fry_stocking_fish_count > 0) {
      bits.push(`${formatNumber(c.fry_stocking_fish_count, 0)} fish`)
    }
    if (startedLabel) bits.push(startedLabel)
    return bits.join(' · ')
  }

  const loadSpecies = useCallback(async () => {
    try {
      const { data } = await api.get<{ id: string; label: string }[]>('/aquaculture/fish-species/')
      setSpecies(Array.isArray(data) ? data : [])
    } catch {
      setSpecies([{ id: 'tilapia', label: 'Tilapia' }])
    }
  }, [])

  const loadTransfers = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get<{ inter_pond_fish_transfer_note?: string; transfers: TransferRow[] }>(
        '/aquaculture/fish-pond-transfers/'
      )
      if (data?.inter_pond_fish_transfer_note) setHelpNote(data.inter_pond_fish_transfer_note)
      setRows(Array.isArray(data?.transfers) ? data.transfers : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, aquacultureT('couldNotLoadTransfers', lang)))
    } finally {
      setLoading(false)
    }
  }, [toast, lang])

  useEffect(() => {
    void loadPonds()
    void loadCycles()
    void loadSpecies()
  }, [loadPonds, loadCycles, loadSpecies])

  /** Refresh batch list when transfer modal opens or source pond changes (e.g. after a new fry bill). */
  useEffect(() => {
    if (!modal) return
    void loadCycles()
  }, [modal, fromPondId, loadCycles])

  useEffect(() => {
    void loadTransfers()
  }, [loadTransfers])

  const selectedFromCycle = useMemo(() => {
    if (!fromCycleId.trim()) return undefined
    const id = parseInt(fromCycleId, 10)
    if (!Number.isFinite(id)) return undefined
    return cycles.find((c) => c.id === id)
  }, [cycles, fromCycleId])

  useEffect(() => {
    if (!modal) {
      setTransferCostBasis(null)
      setTransferCostPerKg(null)
      setTransferCostPerHead(null)
      setTransferPlBasisHint('')
      setTransferCostContext({
        liveFingerlingCount: null,
        stockedFingerlingCount: null,
        movableBioAssetTotal: null,
        pondCostPerFish: null,
      })
      setTransferCostPreviewLoading(false)
      return
    }
    const fp = parseInt(fromPondId, 10)
    if (!Number.isFinite(fp)) {
      setTransferCostBasis(null)
      setTransferCostPerKg(null)
      setTransferCostPerHead(null)
      setTransferPlBasisHint('')
      return
    }

    const requestId = ++costPreviewRequestId.current
    setTransferCostPreviewLoading(true)
    const timer = window.setTimeout(() => {
      void (async () => {
        const body: Record<string, unknown> = {
          from_pond_id: fp,
          transfer_date: transferDate.slice(0, 10),
          lines: lineDrafts.map((ln) => {
            const row: Record<string, unknown> = {}
            const w = ln.weight_kg.trim()
            if (w !== '') row.weight_kg = w
            else row.weight_kg = '0'
            const fc = ln.fish_count.trim()
            if (fc !== '') {
              const n = parseInt(fc, 10)
              if (Number.isFinite(n) && n > 0) row.fish_count = n
            }
            return row
          }),
        }
        if (fromCycleId.trim() && selectedFromCycle && selectedFromCycle.pond_id === fp) {
          body.from_production_cycle_id = parseInt(fromCycleId, 10)
        }
        try {
          const { data } = await api.post<TransferCostPreviewResponse>(
            '/aquaculture/fish-pond-transfers/preview-cost/',
            body,
          )
          if (costPreviewRequestId.current !== requestId) return
          const basis = data?.cost_basis === 'per_head' ? 'per_head' : 'per_kg'
          setTransferCostBasis(basis)
          const pkgRaw = data?.transfer_cost_per_kg
          const pkg =
            pkgRaw != null && String(pkgRaw).trim() !== '' ? Number(pkgRaw) : NaN
          setTransferCostPerKg(Number.isFinite(pkg) && pkg >= 0 ? pkg : null)
          const phRaw = data?.transfer_cost_per_head
          const ph =
            phRaw != null && String(phRaw).trim() !== '' ? Number(phRaw) : NaN
          setTransferCostPerHead(Number.isFinite(ph) && ph >= 0 ? ph : null)
          setTransferPlBasisHint((data?.transfer_cost_basis_note || '').trim())
          const liveRaw = data?.live_fingerling_count
          const stockedRaw = data?.stocked_fingerling_count
          const movableRaw = data?.movable_bio_asset_total
          const cpfRaw = data?.pond_cost_per_fish
          setTransferCostContext({
            liveFingerlingCount:
              liveRaw != null && Number.isFinite(Number(liveRaw)) ? Number(liveRaw) : null,
            stockedFingerlingCount:
              stockedRaw != null && Number.isFinite(Number(stockedRaw)) ? Number(stockedRaw) : null,
            movableBioAssetTotal:
              movableRaw != null && String(movableRaw).trim() !== ''
                ? Number(String(movableRaw).replace(/,/g, ''))
                : null,
            pondCostPerFish:
              cpfRaw != null && String(cpfRaw).trim() !== ''
                ? Number(String(cpfRaw).replace(/,/g, ''))
                : null,
          })

          const previewLines = Array.isArray(data?.lines) ? data.lines : []
          setLineDrafts((drafts) =>
            drafts.map((ln, i) => {
              if (skipAutoCostLine.current.has(i)) return ln
              const raw = previewLines[i]?.cost_amount
              if (raw == null || String(raw).trim() === '') {
                return { ...ln, cost_amount: '' }
              }
              return { ...ln, cost_amount: roundDecimalInputString(String(raw), 2) }
            }),
          )
        } catch {
          if (costPreviewRequestId.current !== requestId) return
          setTransferCostBasis(null)
          setTransferCostPerKg(null)
          setTransferCostPerHead(null)
          setTransferPlBasisHint('')
          setTransferCostContext({
            liveFingerlingCount: null,
            stockedFingerlingCount: null,
            movableBioAssetTotal: null,
            pondCostPerFish: null,
          })
        } finally {
          if (costPreviewRequestId.current === requestId) {
            setTransferCostPreviewLoading(false)
          }
        }
      })()
    }, COST_PREVIEW_DEBOUNCE_MS)

    return () => {
      window.clearTimeout(timer)
    }
  }, [modal, fromPondId, fromCycleId, transferDate, selectedFromCycle, lineCostPreviewKey, lineDrafts.length, costPreviewRevision])

  const applySamplePcsToDraftLines = useCallback(
    (drafts: LineDraft[], fishPerKg: string) => {
      const fpk = fishPerKg.trim()
      if (!fpk) return drafts
      return drafts.map((ln, i) => {
        if (skipAutoPcsLine.current.has(i)) return ln
        let next = { ...ln, pcs_per_kg: roundDecimalInputString(fpk, 2) }
        if (ln.fish_count.trim() !== '') {
          next = recalcTransferLine(next, 'fish')
        }
        return next
      })
    },
    [],
  )

  useEffect(() => {
    if (!modal) {
      setLastSample(null)
      setLastSampleLoading(false)
      setSourceStock(null)
      setSourceStockLoading(false)
      autoCycleFromSampleDone.current = false
      return
    }
    const fp = parseInt(fromPondId, 10)
    if (!Number.isFinite(fp) || !fishSpecies.trim()) {
      setLastSample(null)
      setSourceStock(null)
      return
    }
    const ac = new AbortController()
    setLastSampleLoading(true)
    void (async () => {
      try {
        const params: Record<string, string> = {
          pond_id: String(fp),
          fish_species: fishSpecies,
        }
        if (fishSpecies === 'other' && fishSpeciesOther.trim()) {
          params.fish_species_other = fishSpeciesOther.trim()
        }
        const { data } = await api.get<{ found: boolean } & Partial<LastSampleReference>>(
          '/aquaculture/biomass-samples/last-reference/',
          { params, signal: ac.signal },
        )
        if (ac.signal.aborted) return
        if (data?.found) {
          setLastSample(data as LastSampleReference)
          if (
            editingId == null &&
            !autoCycleFromSampleDone.current &&
            data.production_cycle_id != null &&
            !fromCycleId.trim()
          ) {
            autoCycleFromSampleDone.current = true
            setFromCycleId(String(data.production_cycle_id))
          }
        } else {
          setLastSample(null)
        }
      } catch {
        if (!ac.signal.aborted) setLastSample(null)
      } finally {
        if (!ac.signal.aborted) setLastSampleLoading(false)
      }
    })()
    return () => ac.abort()
  }, [modal, fromPondId, fishSpecies, fishSpeciesOther, editingId])

  /** When the nursing pond has exactly one active fry batch, pre-select it for transfer costing. */
  useEffect(() => {
    if (!modal || editingId != null || fromCycleId.trim()) return
    const cohorts = nursingCohortCycles(fromPondId)
    if (cohorts.length === 1) {
      setFromCycleId(String(cohorts[0].id))
    }
  }, [modal, editingId, fromPondId, fromCycleId, nursingCohortCycles])

  const effectiveSamplePcs = useMemo(() => {
    const raw = lastSample?.fish_per_kg?.trim() ?? ''
    if (!raw) return ''
    const n = Number(raw.replace(/,/g, ''))
    return Number.isFinite(n) && n > 0 ? raw : ''
  }, [lastSample])

  useEffect(() => {
    if (!modal || !effectiveSamplePcs || editingId != null) return
    setLineDrafts((d) => applySamplePcsToDraftLines(d, effectiveSamplePcs))
  }, [modal, effectiveSamplePcs, editingId, applySamplePcsToDraftLines])

  useEffect(() => {
    if (!modal) return
    const fp = parseInt(fromPondId, 10)
    if (!Number.isFinite(fp) || !fishSpecies.trim()) {
      setSourceStock(null)
      return
    }
    const ac = new AbortController()
    setSourceStockLoading(true)
    void (async () => {
      try {
        const params: Record<string, string> = {
          pond_id: String(fp),
          fish_species: fishSpecies,
        }
        if (fromCycleId.trim()) params.production_cycle_id = fromCycleId.trim()
        const { data } = await api.get<{ rows?: SourceStockBrief[] }>('/aquaculture/fish-stock-position/', {
          params,
          signal: ac.signal,
        })
        if (ac.signal.aborted) return
        const row = Array.isArray(data?.rows) && data.rows[0] ? data.rows[0] : null
        if (row && (row.implied_net_fish_count > 0 || Number(row.implied_net_weight_kg) > 0)) {
          setSourceStock(row)
        } else {
          setSourceStock(null)
        }
      } catch {
        if (!ac.signal.aborted) setSourceStock(null)
      } finally {
        if (!ac.signal.aborted) setSourceStockLoading(false)
      }
    })()
    return () => ac.abort()
  }, [modal, fromPondId, fromCycleId, fishSpecies])

  const totalTransferHeads = useMemo(() => {
    let sum = 0
    for (const ln of lineDrafts) {
      const fc = parseInt(String(ln.fish_count).trim(), 10)
      if (Number.isFinite(fc) && fc > 0) sum += fc
    }
    return sum
  }, [lineDrafts])

  /** Book stock + fish this transfer already took from source (edit only — mirrors backend exclude_transfer_id). */
  const effectiveSourceStock = useMemo(() => {
    const baseHeads = sourceStock?.implied_net_fish_count ?? 0
    const baseKg = Number(sourceStock?.implied_net_weight_kg) || 0
    const fp = parseInt(fromPondId, 10)
    if (!editingOriginal || !Number.isFinite(fp)) {
      return { heads: baseHeads, kg: baseKg }
    }
    const addBack = transferOutboundFromSource(editingOriginal, fp, fromCycleId)
    return { heads: baseHeads + addBack.heads, kg: baseKg + addBack.kg }
  }, [sourceStock, editingOriginal, fromPondId, fromCycleId])

  const sampleStaleDays = useMemo(() => {
    if (!lastSample?.sample_date) return null
    return daysSinceIsoDate(lastSample.sample_date)
  }, [lastSample])

  const adjustSkipAutoPcsAfterRemoveLine = (removedIndex: number) => {
    const next = new Set<number>()
    skipAutoPcsLine.current.forEach((j) => {
      if (j < removedIndex) next.add(j)
      else if (j > removedIndex) next.add(j - 1)
    })
    skipAutoPcsLine.current = next
  }

  const adjustSkipAutoCostAfterRemoveLine = (removedIndex: number) => {
    const next = new Set<number>()
    skipAutoCostLine.current.forEach((j) => {
      if (j < removedIndex) next.add(j)
      else if (j > removedIndex) next.add(j - 1)
    })
    skipAutoCostLine.current = next
  }

  const fillRemainderHeads = (lineIdx: number) => {
    const available = effectiveSourceStock.heads
    if (available <= 0) {
      toast.error(aquacultureT('noBookStockSource', lang))
      return
    }
    let sumOther = 0
    for (let i = 0; i < lineDrafts.length; i++) {
      if (i === lineIdx) continue
      const fc = parseInt(String(lineDrafts[i].fish_count).trim(), 10)
      if (Number.isFinite(fc) && fc > 0) sumOther += fc
    }
    const rem = available - sumOther
    if (rem <= 0) {
      toast.error(aquacultureT('allFishUsed', lang))
      return
    }
    setLineDrafts((d) =>
      d.map((row, i) => {
        if (i !== lineIdx) return row
        let next = applyEffectivePcsToLine(
          { ...row, fish_count: String(rem) },
          lineIdx,
          effectiveSamplePcs,
          skipAutoPcsLine.current,
        )
        return recalcTransferLine(next, 'fish')
      }),
    )
  }

  const cyclesForPond = useCallback(
    (pondIdStr: string) => {
      const pid = parseInt(pondIdStr, 10)
      if (!Number.isFinite(pid)) return []
      return cycles
        .filter((c) => c.pond_id === pid)
        .sort((a, b) => {
          const da = a.start_date || ''
          const db = b.start_date || ''
          if (da !== db) return db.localeCompare(da)
          return b.id - a.id
        })
    },
    [cycles],
  )

  const sourceNursingCycles = useMemo(
    () => nursingCohortCycles(fromPondId),
    [nursingCohortCycles, fromPondId],
  )

  const closeModal = () => {
    setModal(false)
    setEditingId(null)
    setEditingOriginal(null)
  }

  const activePonds = useMemo(() => ponds.filter((p) => p.is_active !== false), [ponds])

  const fromPond = useMemo(
    () => activePonds.find((p) => String(p.id) === fromPondId),
    [activePonds, fromPondId],
  )

  const transferDestinations = useMemo(
    () => growOutPondsForTransfers(fromPond, activePonds),
    [fromPond, activePonds],
  )

  const openNew = () => {
    const nursingPonds = activePonds.filter((p) => p.pond_role === 'nursing')
    const fromP = nursingPonds[0] ?? activePonds[0]
    const { sameSite, others } = growOutPondsForTransfers(fromP, activePonds)
    const firstDest = sameSite ?? others[0]
    setEditingId(null)
    setEditingOriginal(null)
    skipAutoCostLine.current = new Set()
    skipAutoPcsLine.current = new Set()
    autoCycleFromSampleDone.current = false
    setFromPondId(fromP ? String(fromP.id) : '')
    setFromCycleId('')
    setTransferDate(new Date().toISOString().slice(0, 10))
    setFishSpecies('tilapia')
    setFishSpeciesOther('')
    setMemo('')
    setLineDrafts([
      {
        ...emptyLine(),
        to_pond_id: firstDest ? String(firstDest.id) : '',
      },
    ])
    setModal(true)
  }

  const openEdit = (t: TransferRow) => {
    setEditingId(t.id)
    setEditingOriginal(t)
    skipAutoCostLine.current = new Set()
    skipAutoPcsLine.current = new Set()
    setFromPondId(String(t.from_pond_id))
    setFromCycleId(t.from_production_cycle_id != null ? String(t.from_production_cycle_id) : '')
    setTransferDate(t.transfer_date.slice(0, 10))
    setFishSpecies(t.fish_species || 'tilapia')
    setFishSpeciesOther((t.fish_species_other || '').trim())
    setMemo(t.memo || '')
    const mapped =
      t.lines.length > 0
        ? t.lines.map((l) => ({
            to_pond_id: String(l.to_pond_id),
            to_production_cycle_id: l.to_production_cycle_id != null ? String(l.to_production_cycle_id) : '',
            weight_kg: (() => {
              const s = String(l.weight_kg ?? '').trim()
              return s === '' ? '' : roundDecimalInputString(s, 2)
            })(),
            fish_count: (() => {
              const s = l.fish_count != null ? String(l.fish_count) : ''
              return s === '' ? '' : roundCountInputString(s)
            })(),
            pcs_per_kg: (() => {
              const s = l.pcs_per_kg != null && String(l.pcs_per_kg) !== '' ? String(l.pcs_per_kg) : ''
              return s === '' ? '' : roundDecimalInputString(s, 2)
            })(),
            cost_amount: (() => {
              const s = String(l.cost_amount ?? '').trim()
              if (s === '' || s === '0' || Number.parseFloat(s) === 0) return ''
              return roundDecimalInputString(s, 2)
            })(),
          }))
        : [emptyLine()]
    mapped.forEach((ln, i) => {
      if (ln.pcs_per_kg.trim() !== '') skipAutoPcsLine.current.add(i)
    })
    setLineDrafts(mapped)
    setModal(true)
  }

  const addSameSiteRemainderLine = () => {
    if (!fromPond) return
    const same = sameSiteGrowOutPond(fromPond, activePonds)
    if (!same) {
      toast.error(aquacultureT('linkGrowOutFirst', lang))
      return
    }
    const fpk = effectiveSamplePcs
    setLineDrafts((rows) => [
      ...rows,
      {
        ...emptyLine(),
        to_pond_id: String(same.id),
        ...(fpk ? { pcs_per_kg: roundDecimalInputString(fpk, 2) } : {}),
      },
    ])
  }

  const submit = async () => {
    const fp = parseInt(fromPondId, 10)
    if (!Number.isFinite(fp)) {
      toast.error(aquacultureT('selectSourcePond', lang))
      return
    }
    if (fishSpecies === 'other' && !fishSpeciesOther.trim()) {
      toast.error('Enter a species description when species is “Other”')
      return
    }
    if (!effectiveSamplePcs && editingId == null) {
      const nursing = fromPond?.pond_role === 'nursing'
      if (nursing) {
        toast.error(
          'Nursing transfers need a recent biomass sample (pcs/kg). Record one under Aquaculture → Sampling, then try again.',
        )
        return
      }
      const ok = window.confirm(
        'No biomass sample found for this pond, cycle, and species. Weight from head count may be wrong. Record a sample under Aquaculture → Sampling first. Save this transfer anyway?'
      )
      if (!ok) return
    }
    if (
      sampleStaleDays != null &&
      sampleStaleDays > SAMPLE_STALE_DAYS &&
      editingId == null
    ) {
      const nursing = fromPond?.pond_role === 'nursing'
      const msg = nursing
        ? `Latest sample is ${sampleStaleDays} days old (>${SAMPLE_STALE_DAYS}). For nursing transfers, re-sample before moving fingerlings. Continue anyway?`
        : `Latest sample is ${sampleStaleDays} days old (>${SAMPLE_STALE_DAYS}). Fingerling size may have changed — consider re-sampling. Continue with this pcs/kg?`
      const ok = window.confirm(msg)
      if (!ok) return
    }
    const available = effectiveSourceStock.heads
    if (available > 0 && totalTransferHeads > available) {
      const ok = window.confirm(
        `Transfer lines total ${formatNumber(totalTransferHeads, 0)} heads but book stock shows ${formatNumber(available, 0)} available. Continue anyway?`
      )
      if (!ok) return
    }
    const linesPayload: Record<string, unknown>[] = []
    for (let i = 0; i < lineDrafts.length; i++) {
      const ln = lineDrafts[i]
      const tp = parseInt(ln.to_pond_id, 10)
      if (!Number.isFinite(tp)) {
        toast.error(`Line ${i + 1}: select destination pond`)
        return
      }
      if (tp === fp) {
        toast.error(`Line ${i + 1}: destination must differ from source pond`)
        return
      }
      const w = roundToDecimals(String(ln.weight_kg).trim().replace(/,/g, ''), 2)
      if (!Number.isFinite(w) || w <= 0) {
        toast.error(`Line ${i + 1}: weight (kg) must be greater than zero`)
        return
      }
      if (ln.fish_count.trim() === '') {
        toast.error(`Line ${i + 1}: fish count (heads) is required`)
        return
      }
      const fc = parseInt(ln.fish_count, 10)
      if (!Number.isFinite(fc) || fc <= 0) {
        toast.error(`Line ${i + 1}: fish count must be a positive integer`)
        return
      }
      if (ln.pcs_per_kg.trim() === '') {
        toast.error(
          `Line ${i + 1}: pcs/kg is required — record a biomass sample or enter pcs/kg manually`
        )
        return
      }
      const pcsCheck = Number(ln.pcs_per_kg.trim().replace(/,/g, ''))
      if (!Number.isFinite(pcsCheck) || pcsCheck <= 0) {
        toast.error(`Line ${i + 1}: pcs/kg must be greater than zero`)
        return
      }
      let costOut = '0'
      if (ln.cost_amount.trim() !== '') {
        const n = Number(ln.cost_amount.trim().replace(/,/g, ''))
        if (!Number.isFinite(n) || n < 0) {
          toast.error(`Line ${i + 1}: cost amount must be a valid non-negative number`)
          return
        }
        // On edit, recalculate from source pond unless user manually overrode cost this session
        const useManualCost = editingId == null || skipAutoCostLine.current.has(i)
        if (useManualCost) {
          costOut = n.toFixed(2)
        }
      }
      const row: Record<string, unknown> = {
        to_pond_id: tp,
        weight_kg: w,
        fish_count: fc,
        cost_amount: costOut,
      }
      if (ln.to_production_cycle_id.trim() !== '') {
        const cy = parseInt(ln.to_production_cycle_id, 10)
        if (!Number.isFinite(cy)) {
          toast.error(`Line ${i + 1}: invalid production cycle`)
          return
        }
        row.to_production_cycle_id = cy
      }
      if (ln.pcs_per_kg.trim() !== '') {
        const pcs = roundToDecimals(ln.pcs_per_kg.trim().replace(/,/g, ''), 2)
        if (!Number.isFinite(pcs) || pcs < 0) {
          toast.error(`Line ${i + 1}: invalid pcs/kg`)
          return
        }
        row.pcs_per_kg = pcs
      }
      linesPayload.push(row)
    }
    const body: Record<string, unknown> = {
      from_pond_id: fp,
      transfer_date: transferDate,
      fish_species: fishSpecies,
      fish_species_other: fishSpecies === 'other' ? fishSpeciesOther.trim() : '',
      memo: memo.trim(),
      lines: linesPayload,
    }
    if (fromCycleId.trim() !== '') {
      const fcy = parseInt(fromCycleId, 10)
      if (!Number.isFinite(fcy)) {
        toast.error(aquacultureT('invalidSourceCycle', lang))
        return
      }
      body.from_production_cycle_id = fcy
    }
    try {
      let glMsg = ''
      let whMsg = ''
      if (editingId != null) {
        const { data } = await api.put<{
          transfer?: TransferRow
          gl_sync?: GlSyncPayload
          nursing_warehouse_transfers?: unknown[]
        }>(`/aquaculture/fish-pond-transfers/${editingId}/`, body)
        glMsg = formatTransferGlMessage(data?.gl_sync, data?.transfer, sym)
        if (data?.nursing_warehouse_transfers?.length) {
          whMsg = aquacultureT('nursingWarehouseMoved', lang)
        }
        toast.success(
          [aquacultureT('transferUpdated', lang), glMsg, whMsg].filter(Boolean).join(' ')
        )
      } else {
        const { data } = await api.post<{
          transfer?: TransferRow
          gl_sync?: GlSyncPayload
          nursing_warehouse_transfers?: unknown[]
        }>('/aquaculture/fish-pond-transfers/', body)
        glMsg = formatTransferGlMessage(data?.gl_sync, data?.transfer, sym)
        if (data?.nursing_warehouse_transfers?.length) {
          whMsg = aquacultureT('nursingWarehouseMoved', lang)
        }
        toast.success(
          [aquacultureT('transferRecorded', lang), glMsg, whMsg].filter(Boolean).join(' ')
        )
      }
      closeModal()
      void loadTransfers()
    } catch (e) {
      toast.error(extractErrorMessage(e, uiT('saveFailed')))
    }
  }

  const remove = async (row: TransferRow) => {
    if (!window.confirm(aquacultureT('confirmRemoveTransfer', lang))) return
    try {
      await api.delete(`/aquaculture/fish-pond-transfers/${row.id}/`)
      toast.success(uiT('deleted'))
      void loadTransfers()
    } catch (e) {
      toast.error(extractErrorMessage(e, uiT('deleteFailed')))
    }
  }

  const totalKg = useMemo(
    () =>
      rows.reduce(
        (acc, t) => acc + t.lines.reduce((a, l) => a + (Number.parseFloat(l.weight_kg) || 0), 0),
        0
      ),
    [rows]
  )

  const totalFish = useMemo(
    () =>
      rows.reduce(
        (acc, t) => acc + t.lines.reduce((a, l) => a + (l.fish_count != null ? Number(l.fish_count) : 0), 0),
        0
      ),
    [rows]
  )

  const sym = getCurrencySymbol(currency)

  return (
    <AquaculturePageShell
      titleId="aq-transfers-title"
      title={pageMeta.title}
      titleIcon={ArrowRightLeft}
      description={pageMeta.description}
      actions={
        <>
          <Link
            href="/reports?report=aquaculture-fingerling-transfers&category=aquaculture"
            className={AQ_HERO_BTN_GHOST}
          >
            <FileBarChart className="h-3.5 w-3.5" aria-hidden />
            Fingerling report
          </Link>
          <button type="button" onClick={() => void loadTransfers()} className={AQ_HERO_BTN_GHOST}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {uiT('refresh')}
          </button>
          <button
            type="button"
            onClick={openNew}
            disabled={loading || ponds.length === 0}
            className={AQ_HERO_BTN_PRIMARY}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {aquacultureT('recordTransfer', lang)}
          </button>
        </>
      }
    >
      {helpNote ? (
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-foreground/85">
          {helpNote}
        </p>
      ) : null}

      {loading ? (
        <div className="mt-10 flex justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      ) : ponds.length === 0 ? (
        <div className="mt-6 rounded-xl border border-warning/30 bg-warning/10 px-4 py-5 text-sm text-warning-foreground">
          <p className="font-medium">{aquacultureT('addPondsFirst', lang)}</p>
          <Link href="/aquaculture/ponds" className="mt-2 inline-block font-medium text-primary underline">
            {aquacultureT('goToPonds', lang)}
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-4 text-xs text-muted-foreground">
            Total in list:{' '}
            <span className="font-medium tabular-nums text-foreground">{formatNumber(totalKg, 2)} kg</span>
            {totalFish > 0 ? (
              <>
                {' '}
                ·{' '}
                <span className="font-medium tabular-nums text-foreground">{formatNumber(totalFish, 0)}</span> head
              </>
            ) : null}
          </p>
          <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
            <table className="min-w-[980px] w-full text-left text-sm">
              <thead className="border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">{uiT("date")}</th>
                  <th className="px-4 py-3">{aquacultureT('fromToCol', lang)}</th>
                  <th className="px-4 py-3">{aquacultureT('species', lang)}</th>
                  <th className="px-4 py-3 text-right">Kg</th>
                  <th className="px-4 py-3 text-right">{pick('Heads', 'Head (টি)')}</th>
                  <th className="px-4 py-3 text-right">{aquacultureT('transferFryCost', lang)}</th>
                  <th className="px-4 py-3 text-right">{aquacultureT('transferOtherExpense', lang)}</th>
                  <th className="px-4 py-3 text-right">{aquacultureT('costMoved', lang)}</th>
                  <th className="px-4 py-3">GL 1581</th>
                  <th className="px-4 py-3 text-right">{uiT("actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-muted-foreground">
                      No transfers yet. Example: log fry on a vendor bill (kg + heads), then record a transfer with each
                      line showing destination pond, kg moved, and head count (required). Optional cost per line
                      reallocates nursing biological cost to grow-out ponds.
                    </td>
                  </tr>
                ) : (
                  rows.map((t) => {
                    const kg = t.lines.reduce((a, l) => a + (Number.parseFloat(l.weight_kg) || 0), 0)
                    const heads = t.lines.reduce((a, l) => a + (l.fish_count != null ? Number(l.fish_count) : 0), 0)
                    const cost =
                      Number.parseFloat(t.cost_total ?? '') ||
                      t.lines.reduce((a, l) => a + (Number.parseFloat(l.cost_amount) || 0), 0)
                    const fryCost =
                      Number.parseFloat(t.fry_cost_total ?? '') ||
                      t.lines.reduce((a, l) => a + (Number.parseFloat(l.fry_cost_amount ?? '') || 0), 0)
                    const otherExpense =
                      Number.parseFloat(t.other_expense_total ?? '') ||
                      t.lines.reduce((a, l) => a + (Number.parseFloat(l.other_expense_amount ?? '') || 0), 0)
                    const dest = t.lines
                      .map((l) => {
                        const h = l.fish_count != null ? `, ${formatNumber(Number(l.fish_count), 0)} head` : ''
                        return `${l.to_pond_name} (${l.weight_kg} kg${h})`
                      })
                      .join('; ')
                    return (
                      <tr key={t.id} className="align-top text-foreground">
                        <td className="px-4 py-3 whitespace-nowrap">{formatDateOnly(t.transfer_date)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-start gap-1.5 font-medium text-foreground">
                            <ArrowRightLeft className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                            <span>
                              {t.from_pond_name}
                              {t.from_production_cycle_name ? (
                                <span className="font-normal text-muted-foreground"> ({t.from_production_cycle_name})</span>
                              ) : null}
                            </span>
                          </div>
                          <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">{dest}</p>
                          {t.memo?.trim() ? <p className="mt-1 text-xs text-muted-foreground">{t.memo.trim()}</p> : null}
                        </td>
                        <td className="px-4 py-3 text-foreground/85">{t.fish_species_label || t.fish_species}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatNumber(kg, 2)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatNumber(heads, 0)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {cost > 0 ? `${sym}${formatNumber(fryCost, 2)}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {cost > 0 ? `${sym}${formatNumber(otherExpense, 2)}` : '—'}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium">
                          {cost > 0 ? (
                            `${sym}${formatNumber(cost, 2)}`
                          ) : kg > 0 ? (
                            <span className="text-warning-foreground" title="Edit and save to fill from source pond P&L">
                              Not set
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {t.gl_posted ? (
                            <span className="text-primary" title={t.journal_entry_number || undefined}>
                              Posted
                              {t.gl_total_amount ? ` · ${sym}${formatNumber(Number(t.gl_total_amount), 2)}` : ''}
                            </span>
                          ) : cost > 0 ? (
                            <span className="text-muted-foreground">Not posted</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center justify-end gap-0.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                openEdit(t)
                              }}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground hover:bg-muted"
                              title={aquacultureT('editTransfer', lang)}
                              aria-label={aquacultureT('editTransfer', lang)}
                            >
                              <Pencil className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                void remove(t)
                              }}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-rose-700 hover:bg-rose-50"
                              title={aquacultureT('removeTransferRollback', lang)}
                              aria-label={aquacultureT('removeTransfer', lang)}
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
        </>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className={MODAL_FORM_SCROLL}>
            <h2 className="text-lg font-semibold text-foreground">
              {editingId != null ? aquacultureT('editFishTransfer', lang) : aquacultureT('recordFishTransfer', lang)}
            </h2>
            {editingId != null ? (
              <p className="mt-2 rounded-lg border border-primary/25 bg-accent px-3 py-2 text-xs leading-relaxed text-teal-950">
                Saving replaces this transfer completely: fish and biological cost move from the new source pond to
                each destination. Prior destinations lose the inbound fish; the prior source pond gets its stock
                back before the new outbound is applied. GL 1581 is deleted and reposted.
              </p>
            ) : null}
            {fromPond?.pond_role === 'nursing' ? (
              <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950">
                <p className="font-medium">{aquacultureT('nursingFingerlingTransfer', lang)}</p>
                <p className="mt-1 text-sky-900">{aquacultureT('nursingEmptyingNote', lang)}</p>
                <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                  {nursingSteps.slice(3).map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ol>
                {transferDestinations.sameSite ? (
                  <p className="mt-2">
                    {aquacultureT('sameSiteGrowOut', lang)}:{' '}
                    <strong>
                      {transferDestinations.sameSite.operational_display_name ||
                        transferDestinations.sameSite.name}
                    </strong>
                  </p>
                ) : null}
              </div>
            ) : null}

            {lastSampleLoading || sourceStockLoading ? (
              <p className="mt-3 text-xs text-muted-foreground">Loading sample &amp; book stock for source pond…</p>
            ) : null}

            {lastSample ? (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2.5 text-sm text-emerald-950">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  <Beaker className="h-4 w-4 shrink-0" aria-hidden />
                  Biomass sample for transfer
                </p>
                <dl className="mt-2 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="text-emerald-800/80">Date</dt>
                    <dd className="font-medium tabular-nums">{formatDateOnly(lastSample.sample_date)}</dd>
                  </div>
                  <div>
                    <dt className="text-emerald-800/80">Pond</dt>
                    <dd className="font-medium">
                      {lastSample.pond_name || fromPond?.name || '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-emerald-800/80">Cycle</dt>
                    <dd className="font-medium">{lastSample.production_cycle_name || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-emerald-800/80">Species</dt>
                    <dd className="font-medium">{lastSample.fish_species_label || '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-emerald-800/80">Sample fish</dt>
                    <dd className="font-medium tabular-nums">
                      {lastSample.estimated_fish_count != null
                        ? formatNumber(lastSample.estimated_fish_count, 0)
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-emerald-800/80">Sample kg</dt>
                    <dd className="font-medium tabular-nums">
                      {lastSample.estimated_total_weight_kg != null
                        ? formatNumber(Number(lastSample.estimated_total_weight_kg), 2)
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-emerald-800/80">Fish/kg (pcs/kg)</dt>
                    <dd className="font-semibold tabular-nums">
                      {effectiveSamplePcs
                        ? formatNumber(Number(effectiveSamplePcs), 2)
                        : '—'}
                    </dd>
                  </div>
                  {lastSample.stock_reference_fish_count != null ? (
                    <div>
                      <dt className="text-emerald-800/80">Book head at sample</dt>
                      <dd className="font-medium tabular-nums">
                        {formatNumber(lastSample.stock_reference_fish_count, 0)}
                      </dd>
                    </div>
                  ) : null}
                </dl>
                {lastSample.cycle_scope_fallback ? (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-warning-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    No sample on the selected source cycle — using latest sample for this pond and species (
                    {lastSample.production_cycle_name || 'cycle'}).
                  </p>
                ) : null}
                {lastSample.site_scope_fallback ? (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-warning-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    Latest seine sample for this physical site was recorded on{' '}
                    <strong>{lastSample.pond_name || 'another profit center'}</strong> — pcs/kg and book head are
                    still applied to this transfer.
                  </p>
                ) : null}
                {!effectiveSamplePcs ? (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-warning-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    Sample found but pcs/kg could not be calculated — enter seine fish count and sample kg on the
                    sampling record, or type pcs/kg manually on each line.
                  </p>
                ) : sampleStaleDays != null && sampleStaleDays > SAMPLE_STALE_DAYS ? (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-warning-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                    Sample is {sampleStaleDays} days old — consider re-sampling before large transfers.
                  </p>
                ) : effectiveSamplePcs ? (
                  <p className="mt-2 text-xs text-emerald-800/90">
                    Pcs/kg is applied from this record. Enter <strong>fish count (heads)</strong> per line — weight and
                    cost derive automatically (all fields stay editable).
                  </p>
                ) : null}
                <Link
                  href="/aquaculture/sampling"
                  className="mt-1 inline-block text-xs font-medium text-primary underline hover:text-teal-950"
                >
                  Open sampling
                </Link>
              </div>
            ) : !lastSampleLoading && !sourceStockLoading && modal && fromPondId && !lastSample ? (
              <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-sm text-warning-foreground">
                <p className="flex items-start gap-2 font-medium">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  No live biomass sample for this pond and species
                </p>
                <p className="mt-1 text-xs leading-relaxed">
                  Select the source pond where you recorded the sample (e.g. Digonta Nursing), then record seine
                  weighing under Sampling if needed. You can still save by entering pcs/kg manually on each line.
                </p>
                <Link
                  href="/aquaculture/sampling"
                  className="mt-1 inline-block text-xs font-medium text-primary underline hover:text-teal-950"
                >
                  Record sample now
                </Link>
              </div>
            ) : null}

            {sourceStock ? (
              <div className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-foreground">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  <Fish className="h-4 w-4 text-muted-foreground" aria-hidden />
                  Book stock (source pond)
                  <span className="tabular-nums font-semibold">
                    {formatNumber(sourceStock.implied_net_fish_count, 0)} fish
                    {(() => {
                      const bookKg = Number(sourceStock.implied_net_weight_kg)
                      const effRaw = sourceStock.effective_net_weight_kg?.trim()
                      const effKg =
                        effRaw != null && effRaw !== '' ? Number(effRaw) : Number.NaN
                      const showEff =
                        Number.isFinite(effKg) &&
                        effKg > 0 &&
                        (!Number.isFinite(bookKg) || Math.abs(effKg - bookKg) > 0.05)
                      if (showEff) {
                        return (
                          <>
                            {' '}
                            · ~{formatNumber(effKg, 2)} kg est. biomass
                            <span className="text-xs font-normal text-muted-foreground">
                              {' '}
                              (book {formatNumber(bookKg, 2)} kg)
                            </span>
                          </>
                        )
                      }
                      return <> · {formatNumber(bookKg, 2)} kg</>
                    })()}
                    {sourceStock.current_fish_per_kg ? (
                      <>
                        {' '}
                        · {formatNumber(Number(sourceStock.current_fish_per_kg), 1)} pcs/kg
                      </>
                    ) : null}
                    {sourceStock.current_avg_weight_kg ? (
                      <>
                        {' '}
                        · avg {formatNumber(Number(sourceStock.current_avg_weight_kg), 4)} kg/fish
                      </>
                    ) : null}
                    {sourceStock.stock_density_kg_per_decimal ? (
                      <>
                        {' '}
                        · {formatNumber(Number(sourceStock.stock_density_kg_per_decimal), 1)} kg/dec
                      </>
                    ) : null}
                  </span>
                </p>
                {transferCostContext.liveFingerlingCount != null &&
                transferCostContext.movableBioAssetTotal != null &&
                transferCostContext.movableBioAssetTotal > 0 ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Movable production cost{' '}
                    <span className="tabular-nums font-medium text-foreground">
                      {sym}
                      {formatNumber(transferCostContext.movableBioAssetTotal, 2)}
                    </span>
                    {' ÷ '}
                    {formatNumber(transferCostContext.liveFingerlingCount, 0)} live fingerlings
                    {transferCostContext.stockedFingerlingCount != null &&
                    transferCostContext.stockedFingerlingCount >
                      transferCostContext.liveFingerlingCount ? (
                      <>
                        {' '}
                        (stocked {formatNumber(transferCostContext.stockedFingerlingCount, 0)})
                      </>
                    ) : null}
                    {transferCostPerHead != null ? (
                      <>
                        {' '}
                        = {sym}
                        {formatNumber(transferCostPerHead, 2)}/head
                      </>
                    ) : transferCostContext.pondCostPerFish != null ? (
                      <>
                        {' '}
                        ≈ {sym}
                        {formatNumber(transferCostContext.pondCostPerFish, 2)}/head
                      </>
                    ) : null}
                  </p>
                ) : null}
                {totalTransferHeads > 0 ? (
                  <p
                    className={`mt-1 text-xs tabular-nums ${
                      effectiveSourceStock.heads > 0 && totalTransferHeads > effectiveSourceStock.heads
                        ? 'font-medium text-rose-700'
                        : 'text-muted-foreground'
                    }`}
                  >
                    This transfer: {formatNumber(totalTransferHeads, 0)} heads
                    {effectiveSourceStock.heads > 0 ? (
                      <>
                        {' '}
                        · Remaining after:{' '}
                        {formatNumber(Math.max(0, effectiveSourceStock.heads - totalTransferHeads), 0)} fish
                      </>
                    ) : null}
                    {editingOriginal ? (
                      <span className="block font-normal text-primary">
                        Edit mode: book stock above includes fish this transfer already moved from the source pond.
                      </span>
                    ) : null}
                  </p>
                ) : null}
              </div>
            ) : null}
            <div className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm font-medium text-foreground/85">
                  From pond (source)
                  <select
                    className="mt-1 w-full rounded-lg border border-border px-3 py-2"
                    value={fromPondId}
                    onChange={(e) => {
                      setFromPondId(e.target.value)
                      setFromCycleId('')
                      autoCycleFromSampleDone.current = false
                    }}
                  >
                    <option value="">Select source pond…</option>
                    {activePonds.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.operational_display_name || p.name}
                        {p.pond_role === 'nursing'
                          ? ` (nursing${p.physical_site_name ? ` · ${p.physical_site_name}` : ''})`
                          : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm font-medium text-foreground/85">
                  Transfer date
                  <CompanyDateInput value={transferDate} onChange={setTransferDate} className="mt-1 w-full rounded-lg border border-border px-3 py-2" />
                </label>
              </div>
              <label className="block text-sm font-medium text-foreground/85">
                Source stocking batch (nursing cohort)
                <div className="mt-1 flex gap-2">
                  <select
                    className="min-w-0 flex-1 rounded-lg border border-border px-3 py-2"
                    value={fromCycleId}
                    onChange={(e) => setFromCycleId(e.target.value)}
                  >
                    <option value="">— None —</option>
                    {sourceNursingCycles.map((c) => (
                      <option key={c.id} value={c.id}>
                        {formatCycleOptionLabel(c)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-medium text-primary hover:bg-muted/60"
                    title="Reload batches (e.g. after posting a fry bill)"
                    onClick={() => void loadCycles()}
                  >
                    Refresh
                  </button>
                </div>
                {fromPondId && sourceNursingCycles.length === 0 ? (
                  <span className="mt-1 block text-xs font-medium text-amber-800">
                    No nursing batch on this pond yet — post a fry vendor bill (leave batch blank to auto-create
                    C01/C02), then click Refresh.
                  </span>
                ) : (
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    Pick the fry batch leaving nursing (e.g. C02). FSERP opens a linked grow-out batch on each
                    destination pond when you leave destination batch blank.
                  </span>
                )}
              </label>
              <label className="block text-sm font-medium text-foreground/85">
                Species
                <select
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2"
                  value={fishSpecies}
                  onChange={(e) => {
                    const v = e.target.value
                    setFishSpecies(v)
                    if (v !== 'other') setFishSpeciesOther('')
                    autoCycleFromSampleDone.current = false
                  }}
                >
                  {species.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              {fishSpecies === 'other' ? (
                <label className="block text-sm font-medium text-foreground/85">
                  Species description
                  <input
                    type="text"
                    className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                    value={fishSpeciesOther}
                    onChange={(e) => setFishSpeciesOther(e.target.value)}
                    placeholder="e.g. local strain"
                    maxLength={120}
                  />
                </label>
              ) : null}

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground/85">Destination lines</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={!hasAutoTransferCostRate}
                      className="text-sm font-medium text-primary hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground/70 disabled:no-underline"
                      onClick={() => {
                        skipAutoCostLine.current = new Set()
                        setCostPreviewRevision((r) => r + 1)
                      }}
                    >
                      Reset costs to auto
                    </button>
                    <button
                      type="button"
                      className="text-sm font-medium text-primary hover:underline"
                      onClick={addSameSiteRemainderLine}
                    >
                      + Same-site grow-out
                    </button>
                    <button
                      type="button"
                      className="text-sm font-medium text-primary hover:underline"
                      onClick={() =>
                        setLineDrafts((d) => [
                          ...d,
                          {
                            ...emptyLine(),
                            ...(effectiveSamplePcs
                              ? { pcs_per_kg: roundDecimalInputString(effectiveSamplePcs, 2) }
                              : {}),
                          },
                        ])
                      }
                    >
                      + Add line
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {transferCostPreviewLoading ? (
                    <span>Calculating transfer cost from pond production costs…</span>
                  ) : hasAutoTransferCostRate ? (
                    <span>
                      Enter <strong className="font-medium text-foreground">fish count (heads)</strong> on each line
                      first — weight (kg) and cost fill from the latest sample pcs/kg and pond production costs (
                      {transferCostBasis === 'per_head' && transferCostPerHead != null ? (
                        <span className="tabular-nums font-medium text-foreground">
                          {sym}
                          {formatNumber(transferCostPerHead, 2)}/head
                        </span>
                      ) : transferCostPerKg != null ? (
                        <span className="tabular-nums font-medium text-foreground">
                          {sym}
                          {formatNumber(transferCostPerKg, 2)}/kg
                        </span>
                      ) : null}
                      ). Edit any field to override.
                    </span>
                  ) : (
                    <span>
                      Enter heads first; weight derives from sample pcs/kg when available. Auto cost needs pond
                      costs recorded — otherwise enter cost manually.
                    </span>
                  )}
                </p>
                {transferPlBasisHint ? (
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{transferPlBasisHint}</p>
                ) : null}
                <div className="mt-2 space-y-3">
                  {lineDrafts.map((ln, idx) => (
                    <div key={idx} className="rounded-lg border border-border bg-muted/50 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Line {idx + 1}</span>
                        {lineDrafts.length > 1 ? (
                          <button
                            type="button"
                            className="text-xs text-rose-700 hover:underline"
                            onClick={() => {
                              adjustSkipAutoCostAfterRemoveLine(idx)
                              adjustSkipAutoPcsAfterRemoveLine(idx)
                              setLineDrafts((d) => d.filter((_, i) => i !== idx))
                            }}
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="text-xs text-muted-foreground">
                          To pond
                          <select
                            className="mt-0.5 w-full rounded border border-border bg-white px-2 py-1.5 text-sm"
                            value={ln.to_pond_id}
                            onChange={(e) => {
                              const v = e.target.value
                              setLineDrafts((d) =>
                                d.map((row, i) => (i === idx ? { ...row, to_pond_id: v, to_production_cycle_id: '' } : row))
                              )
                            }}
                          >
                            <option value="">—</option>
                            {activePonds
                              .filter((p) => String(p.id) !== fromPondId)
                              .map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.operational_display_name || p.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label className="text-xs text-muted-foreground">
                          To cycle (optional)
                          <select
                            className="mt-0.5 w-full rounded border border-border bg-white px-2 py-1.5 text-sm"
                            value={ln.to_production_cycle_id}
                            onChange={(e) => {
                              const v = e.target.value
                              setLineDrafts((d) => d.map((row, i) => (i === idx ? { ...row, to_production_cycle_id: v } : row)))
                            }}
                          >
                            <option value="">—</option>
                            {cyclesForPond(ln.to_pond_id).map((c) => (
                              <option key={c.id} value={c.id}>
                                {formatCycleOptionLabel(c)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="text-xs font-medium text-foreground/85 sm:col-span-2">
                          Fish count (heads) * — enter first
                          <input
                            className="mt-0.5 w-full rounded border border-primary/35 bg-white px-2 py-1.5 text-sm tabular-nums"
                            inputMode="numeric"
                            placeholder="e.g. 200000"
                            value={ln.fish_count}
                            onChange={(e) => {
                              const fish_count = e.target.value
                              setLineDrafts((d) =>
                                d.map((row, i) => {
                                  if (i !== idx) return row
                                  let next = applyEffectivePcsToLine(
                                    { ...row, fish_count },
                                    idx,
                                    effectiveSamplePcs,
                                    skipAutoPcsLine.current,
                                  )
                                  return recalcTransferLine(next, 'fish')
                                })
                              )
                            }}
                            onBlur={() => {
                              setLineDrafts((d) =>
                                d.map((row, i) => {
                                  if (i !== idx) return row
                                  const t = row.fish_count.trim()
                                  if (t === '') return row
                                  let next = applyEffectivePcsToLine(
                                    { ...row, fish_count: roundCountInputString(row.fish_count) },
                                    idx,
                                    effectiveSamplePcs,
                                    skipAutoPcsLine.current,
                                  )
                                  return recalcTransferLine(next, 'fish')
                                })
                              )
                            }}
                          />
                        </label>
                        <label className="text-xs text-muted-foreground">
                          Pcs/kg {lastSample ? '(from sample)' : effectiveSamplePcs ? '(from sample)' : '*'}
                          <input
                            className="mt-0.5 w-full rounded border border-border bg-white px-2 py-1.5 text-sm tabular-nums"
                            inputMode="decimal"
                            placeholder={
                              lastSample?.fish_per_kg ??
                              (effectiveSamplePcs || 'Enter measured pcs/kg')
                            }
                            value={ln.pcs_per_kg}
                            onChange={(e) => {
                              const pcs_per_kg = e.target.value
                              if (pcs_per_kg.trim() === '') skipAutoPcsLine.current.delete(idx)
                              else skipAutoPcsLine.current.add(idx)
                              setLineDrafts((d) =>
                                d.map((row, i) => {
                                  if (i !== idx) return row
                                  return recalcTransferLine({ ...row, pcs_per_kg }, 'pcs')
                                })
                              )
                            }}
                            onBlur={() => {
                              setLineDrafts((d) =>
                                d.map((row, i) => {
                                  if (i !== idx) return row
                                  const t = row.pcs_per_kg.trim()
                                  if (t === '') return row
                                  let next = { ...row, pcs_per_kg: roundDecimalInputString(row.pcs_per_kg, 2) }
                                  next = recalcTransferLine(next, 'pcs')
                                  return next
                                })
                              )
                            }}
                          />
                        </label>
                        <label className="text-xs text-muted-foreground">
                          Weight (kg) * — auto from heads ÷ pcs/kg
                          <input
                            className="mt-0.5 w-full rounded border border-border bg-muted/40 px-2 py-1.5 text-sm tabular-nums"
                            inputMode="decimal"
                            placeholder="Filled when heads + pcs/kg set"
                            value={ln.weight_kg}
                            onChange={(e) => {
                              const weight_kg = e.target.value
                              setLineDrafts((d) =>
                                d.map((row, i) => {
                                  if (i !== idx) return row
                                  return recalcTransferLine({ ...row, weight_kg }, 'weight')
                                })
                              )
                            }}
                            onBlur={() => {
                              setLineDrafts((d) =>
                                d.map((row, i) => {
                                  if (i !== idx) return row
                                  const t = row.weight_kg.trim()
                                  if (t === '') return row
                                  let next = { ...row, weight_kg: roundDecimalInputString(row.weight_kg, 2) }
                                  next = recalcTransferLine(next, 'weight')
                                  return next
                                })
                              )
                            }}
                          />
                        </label>
                        <label className="text-xs text-muted-foreground">
                          Cost amount (BDT)
                          <input
                            className="mt-0.5 w-full rounded border border-border bg-white px-2 py-1.5 text-sm tabular-nums"
                            inputMode="decimal"
                            placeholder={hasAutoTransferCostRate ? 'Auto when heads/kg entered' : 'Enter manually'}
                            value={ln.cost_amount}
                            onChange={(e) => {
                              const v = e.target.value
                              if (v.trim() === '') skipAutoCostLine.current.delete(idx)
                              else skipAutoCostLine.current.add(idx)
                              setLineDrafts((d) => d.map((row, i) => (i === idx ? { ...row, cost_amount: v } : row)))
                            }}
                            onBlur={() => {
                              setLineDrafts((d) =>
                                d.map((row, i) => {
                                  if (i !== idx) return row
                                  const t = row.cost_amount.trim()
                                  if (t === '') return row
                                  return { ...row, cost_amount: roundDecimalInputString(row.cost_amount, 2) }
                                })
                              )
                            }}
                          />
                        </label>
                      </div>
                      {effectiveSourceStock.heads > 0 ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="text-xs font-medium text-primary underline hover:text-teal-950"
                            onClick={() => fillRemainderHeads(idx)}
                          >
                            Fill remainder ({formatNumber(
                              Math.max(
                                0,
                                effectiveSourceStock.heads -
                                  totalTransferHeads +
                                  (parseInt(String(ln.fish_count).trim(), 10) || 0),
                              ),
                              0,
                            )}{' '}
                            heads)
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <label className="block text-sm font-medium text-foreground/85">
                Memo
                <textarea
                  className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm"
                  rows={2}
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="e.g. Post-nursing split batch 2026-A"
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
                onClick={closeModal}
              >
                {uiT("cancel")}
              </button>
              <button
                type="button"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary"
                onClick={() => void submit()}
              >
                {editingId != null ? aquacultureT('saveChanges', lang) : aquacultureT('saveTransfer', lang)}
              </button>
            </div>
          </div>
        </div>
      )}
    </AquaculturePageShell>
  )
}
