'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Gauge, Info, Pen, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { AquaculturePageShell } from '@/components/aquaculture/AquaculturePageShell'
import { AQ_HERO_BTN_GHOST, AQ_HERO_BTN_PRIMARY } from '@/components/aquaculture/AquacultureUi'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { formatNumber } from '@/utils/currency'
import { formatDateOnly, localDateISO } from '@/utils/date'
import { CompanyDateInput } from '@/components/CompanyDateInput'
import { PartialHarvestAdvicePanel } from '../PartialHarvestAdvicePanel'
import { loadLevelBadgeClass, type StockMetricsRow } from '../aquacultureFishMetrics'
import { usePageMeta } from '@/hooks/usePageMeta'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'
import { aquacultureT, type AdviceLanguage } from '@/lib/aquacultureI18n'
import { useT } from '@/lib/i18n'

interface Pond {
  id: number
  name: string
  operational_display_name?: string
  is_active?: boolean
  pond_role?: string
}
interface FishSpeciesOpt {
  id: string
  label: string
}

interface SampleRow {
  id: number
  pond_id: number
  pond_name: string
  production_cycle_id?: number | null
  production_cycle_name?: string
  sample_date: string
  fish_species?: string
  fish_species_other?: string
  fish_species_label?: string
  estimated_fish_count: number | null
  estimated_total_weight_kg: string | null
  avg_weight_kg: string | null
  stock_reference_fish_count?: number | null
  stock_reference_net_weight_kg?: string | null
  stock_reference_avg_weight_kg?: string | null
  extrapolated_biomass_kg?: string | null
  biomass_gain_kg?: string | null
  notes: string
  source_fish_sale_id?: number | null
  market_price_per_kg?: string | null
  market_value?: string | null
  book_bioasset_value?: string | null
  book_cost_per_kg?: string | null
  bioasset_margin?: string | null
  bioasset_margin_per_kg?: string | null
  biological_production_cost?: string | null
  full_cost_base?: string | null
  full_cycle_margin?: string | null
  full_cycle_margin_per_kg?: string | null
  load_level?: string
  load_level_label?: string
  stock_density_kg_per_decimal?: string | null
  partial_harvest_applicable?: boolean
  partial_harvest_suggested_kg?: string | null
  partial_harvest_suggested_fish_count?: number | null
  owner_decision_recommended?: boolean
  owner_decision_summary?: string
  owner_action?: string
  comfort_kg_per_decimal?: string | null
  water_area_decimal?: string | null
  advice_summary?: string
  partial_harvest_rationale?: string
}

type LoadAdvicePreview = StockMetricsRow & {
  owner_decision_recommended?: boolean
  owner_decision_summary?: string
  owner_action?: string
  comfort_kg_per_decimal?: string | null
}

interface CycleRow {
  id: number
  name: string
}

interface PositionRow {
  implied_net_fish_count: number
  implied_net_weight_kg: string
  stocked_fish_count?: number
  stocked_weight_kg?: string
}

interface ValuationPreview {
  market_price_per_kg: string
  extrapolated_biomass_kg: string
  market_value: string | null
  book_bioasset_value: string | null
  book_cost_per_kg: string | null
  bioasset_margin: string | null
  bioasset_margin_per_kg: string | null
  biological_production_cost: string | null
  full_cost_base: string | null
  full_cycle_margin: string | null
  full_cycle_margin_per_kg: string | null
}

function formatMeanKgPerFish(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  const decimals = Math.abs(v) > 0 && Math.abs(v) < 0.01 ? 4 : 2
  return formatNumber(v, decimals)
}

function referenceAvgKgFromStock(stock: PositionRow): number | null {
  const tc = stock.implied_net_fish_count
  const tw = Number(String(stock.implied_net_weight_kg).replace(/,/g, ''))
  if (tc > 0 && Number.isFinite(tw) && tw > 0) return tw / tc
  const stockedC = stock.stocked_fish_count ?? 0
  const stockedW = Number(String(stock.stocked_weight_kg ?? '').replace(/,/g, ''))
  if (stockedC > 0 && Number.isFinite(stockedW) && stockedW > 0) return stockedW / stockedC
  return null
}

/** total_kg / fish_count when both are valid and count > 0 */
function computeAvgWeightKg(fishCountStr: string, totalKgStr: string): number | null {
  const countStr = fishCountStr.trim()
  const wStr = totalKgStr.trim()
  if (!countStr || !wStr) return null
  const count = parseInt(countStr, 10)
  const total = Number(wStr)
  if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(total) || total < 0) return null
  return total / count
}

function pcsPerKgFromSample(r: SampleRow): number | null {
  const c = r.estimated_fish_count
  const w = r.estimated_total_weight_kg
  if (c == null || c <= 0 || w == null || w === '') return null
  const tw = Number(w)
  if (!Number.isFinite(tw) || tw <= 0) return null
  return c / tw
}

function sampleGroupKey(r: SampleRow): string {
  const cycle = r.production_cycle_id ?? 'none'
  return `${r.pond_id}:${cycle}`
}

function daysBetweenSampleDates(start: string, end: string): number {
  const a = new Date(start.split('T')[0])
  const b = new Date(end.split('T')[0])
  const diff = Math.round((b.getTime() - a.getTime()) / 86400000)
  return Math.max(1, diff)
}

/** ADG (g/fish/day) since the previous sample in the same pond + batch. */
function intervalAdgFromSamples(prev: SampleRow, cur: SampleRow): number | null {
  const prevMean = displayAvgWeightKg(prev)
  const curMean = displayAvgWeightKg(cur)
  if (prevMean == null || curMean == null || prevMean <= 0) return null
  const days = daysBetweenSampleDates(prev.sample_date, cur.sample_date)
  return ((curMean - prevMean) * 1000) / days
}

type SampleGrowthMetrics = {
  pcsPerKg: number | null
  adgGPerFishPerDay: number | null
  daysSincePrev: number | null
  prevSampleDate: string | null
}

function buildSampleGrowthMetrics(rows: SampleRow[]): Map<number, SampleGrowthMetrics> {
  const byGroup = new Map<string, SampleRow[]>()
  for (const r of rows) {
    const key = sampleGroupKey(r)
    const list = byGroup.get(key) ?? []
    list.push(r)
    byGroup.set(key, list)
  }

  const out = new Map<number, SampleGrowthMetrics>()
  for (const list of byGroup.values()) {
    const sorted = [...list].sort((a, b) => {
      const byDate = a.sample_date.localeCompare(b.sample_date)
      return byDate !== 0 ? byDate : a.id - b.id
    })
    for (let i = 0; i < sorted.length; i++) {
      const cur = sorted[i]
      const prev = i > 0 ? sorted[i - 1] : null
      out.set(cur.id, {
        pcsPerKg: pcsPerKgFromSample(cur),
        adgGPerFishPerDay: prev ? intervalAdgFromSamples(prev, cur) : null,
        daysSincePrev: prev ? daysBetweenSampleDates(prev.sample_date, cur.sample_date) : null,
        prevSampleDate: prev ? prev.sample_date.split('T')[0] : null,
      })
    }
  }
  return out
}

function displayAvgWeightKg(r: SampleRow): number | null {
  const c = r.estimated_fish_count
  const w = r.estimated_total_weight_kg
  if (c != null && c > 0 && w != null && w !== '') {
    const tw = Number(w)
    if (Number.isFinite(tw) && tw >= 0) return tw / c
  }
  if (r.avg_weight_kg != null && r.avg_weight_kg !== '') {
    const x = Number(r.avg_weight_kg)
    if (Number.isFinite(x)) return x
  }
  return null
}

function parseNum(s: string | null | undefined): number | null {
  if (s == null || s === '') return null
  const x = Number(String(s).replace(/,/g, ''))
  return Number.isFinite(x) ? x : null
}

function formatMoney(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return formatNumber(v, 2)
}

function marginClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return ''
  return v >= 0 ? 'text-emerald-800' : 'text-rose-800'
}

/** Two-line cell: muted label + value (plain language, no cryptic abbreviations). */
function MetricCell({
  lines,
  align = 'left',
}: {
  lines: { label: string; value: ReactNode; valueClass?: string }[]
  align?: 'left' | 'right'
}) {
  return (
    <div className={`space-y-1 ${align === 'right' ? 'text-right' : ''}`}>
      {lines.map((line) => (
        <div key={line.label} className={align === 'right' ? '' : ''}>
          <div className="text-[10px] font-medium leading-tight text-slate-500">{line.label}</div>
          <div className={`text-xs tabular-nums leading-snug text-slate-800 ${line.valueClass || ''}`}>
            {line.value}
          </div>
        </div>
      ))}
    </div>
  )
}

function harvestAdviceLines(
  r: SampleRow,
  lang: AdviceLanguage
): { lines: { label: string; value: ReactNode; valueClass?: string }[]; title?: string } {
  const title = r.owner_decision_summary || r.partial_harvest_rationale || r.advice_summary || undefined
  if (!r.load_level_label) {
    return { lines: [{ label: aquacultureT('pondLoad', lang), value: '—' }], title }
  }
  const density = r.stock_density_kg_per_decimal
    ? `${formatNumber(Number(r.stock_density_kg_per_decimal), 1)} ${aquacultureT('kgPerDecimalWater', lang)}`
    : r.water_area_decimal
      ? '—'
      : aquacultureT('setWaterAreaOnPond', lang)
  const lines: { label: string; value: ReactNode; valueClass?: string }[] = [
    {
      label: aquacultureT('stockingLoad', lang),
      value: (
        <span className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-semibold ${loadLevelBadgeClass(r.load_level)}`}>
          {r.load_level_label}
        </span>
      ),
    },
    { label: aquacultureT('density', lang), value: density },
  ]
  if (r.partial_harvest_applicable && r.partial_harvest_suggested_kg) {
    const kg = formatNumber(Number(r.partial_harvest_suggested_kg), 0)
    const fish = r.partial_harvest_suggested_fish_count
    lines.push({
      label: aquacultureT('suggestedPartialHarvest', lang),
      value: fish
        ? `${aquacultureT('removeAboutKg', lang)} ${kg} kg (~${formatNumber(fish, 0)} ${aquacultureT('fish', lang)})`
        : `${aquacultureT('removeAboutKg', lang)} ${kg} ${aquacultureT('removeAboutKgSuffix', lang)}`,
      valueClass: 'font-medium text-amber-900',
    })
  } else if (r.owner_action === 'monitor' || r.owner_action === 'grow') {
    lines.push({
      label: aquacultureT('harvest', lang),
      value: aquacultureT('noThinningNeeded', lang),
      valueClass: 'text-emerald-800',
    })
  }
  return { lines, title }
}

const thMain = 'px-2.5 py-2 text-left text-xs font-semibold text-slate-800'
const thSub = 'mt-0.5 block text-[10px] font-normal leading-snug text-slate-500'
const tdCell = 'px-2.5 py-2 align-top'

/** Live preview: same logic as backend apply_aquaculture_biomass_sample_extrapolation */
function extrapolationPreview(
  sampleCount: number,
  sampleKg: number,
  stock: PositionRow | null,
): {
  refHead: number | null
  refNetKg: number | null
  refAvgKg: number | null
  sampleAvgKg: number
  biomassKg: number | null
  gainKg: number | null
} {
  const sampleAvgKg = sampleKg / sampleCount
  if (!stock) {
    return {
      refHead: null,
      refNetKg: null,
      refAvgKg: null,
      sampleAvgKg,
      biomassKg: null,
      gainKg: null,
    }
  }
  const tc = stock.implied_net_fish_count
  const tw = Number(String(stock.implied_net_weight_kg).replace(/,/g, ''))
  const refHead = tc > 0 ? tc : null
  const refNetKg = Number.isFinite(tw) ? tw : null
  const refAvgKg = referenceAvgKgFromStock(stock)
  if (refHead == null || refHead <= 0) {
    return { refHead, refNetKg, refAvgKg, sampleAvgKg, biomassKg: null, gainKg: null }
  }
  const biomassKg = sampleAvgKg * refHead
  const gainKg = refAvgKg != null ? (sampleAvgKg - refAvgKg) * refHead : null
  return { refHead, refNetKg, refAvgKg, sampleAvgKg, biomassKg, gainKg }
}

export default function AquacultureSamplingPage() {
  const toast = useToast()
  const pageMeta = usePageMeta()
  const { language: lang } = useCompanyLocale()
  const { t } = useT()
  const [ponds, setPonds] = useState<Pond[]>([])
  const [fishSpeciesOpts, setFishSpeciesOpts] = useState<FishSpeciesOpt[]>([])
  const [cycles, setCycles] = useState<CycleRow[]>([])
  const [rows, setRows] = useState<SampleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filterPond, setFilterPond] = useState('')
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<SampleRow | null>(null)
  const [form, setForm] = useState({
    pond_id: '',
    production_cycle_id: '',
    sample_date: '',
    fish_species: 'tilapia',
    fish_species_other: '',
    estimated_fish_count: '',
    estimated_total_weight_kg: '',
    market_price_per_kg: '',
    notes: '',
  })
  const [stockPreview, setStockPreview] = useState<PositionRow | null>(null)
  const [stockPreviewLoading, setStockPreviewLoading] = useState(false)
  const [valuationPreview, setValuationPreview] = useState<ValuationPreview | null>(null)
  const [valuationPreviewLoading, setValuationPreviewLoading] = useState(false)
  const [loadAdvicePreview, setLoadAdvicePreview] = useState<LoadAdvicePreview | null>(null)
  const [loadAdviceLoading, setLoadAdviceLoading] = useState(false)

  const activePonds = useMemo(
    () => ponds.filter((p) => p.is_active !== false),
    [ponds],
  )

  const growthBySampleId = useMemo(() => buildSampleGrowthMetrics(rows), [rows])

  const pondLabel = useCallback(
    (p: Pond) => p.operational_display_name?.trim() || p.name,
    [],
  )

  const speciesOptionsForSampling = (
    fishSpeciesOpts.length ? fishSpeciesOpts : [{ id: 'tilapia', label: 'Tilapia' }]
  ).filter((s) => s.id !== 'not_applicable')

  const loadPonds = useCallback(async () => {
    try {
      const [pRes, spRes] = await Promise.all([
        api.get<Pond[]>('/aquaculture/ponds/'),
        api.get<FishSpeciesOpt[]>('/aquaculture/fish-species/').catch(() => ({ data: [] })),
      ])
      setPonds(Array.isArray(pRes.data) ? pRes.data : [])
      setFishSpeciesOpts(Array.isArray(spRes.data) ? spRes.data : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, aquacultureT('couldNotLoadPonds', lang)))
    }
  }, [toast, lang])

  const loadRows = useCallback(async () => {
    setLoading(true)
    try {
      const params = filterPond ? { pond_id: filterPond } : undefined
      const { data } = await api.get<SampleRow[]>('/aquaculture/samples/', { params })
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, aquacultureT('couldNotLoadSamples', lang)))
    } finally {
      setLoading(false)
    }
  }, [toast, filterPond, lang])

  useEffect(() => {
    void loadPonds()
  }, [loadPonds])

  useEffect(() => {
    void loadRows()
  }, [loadRows])

  useEffect(() => {
    const pid = form.pond_id
    if (!modal || !pid) {
      setCycles([])
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
  }, [modal, form.pond_id])

  const refreshStockPreview = useCallback(async () => {
    const pid = form.pond_id
    const species = (form.fish_species || 'tilapia').trim()
    if (!modal || !pid || !species) {
      setStockPreview(null)
      return
    }
    setStockPreviewLoading(true)
    try {
      const params: Record<string, string> = {
        pond_id: pid,
        fish_species: species,
      }
      if (form.production_cycle_id) params.production_cycle_id = form.production_cycle_id
      const { data } = await api.get<{ rows: PositionRow[] }>('/aquaculture/fish-stock-position/', { params })
      const row = Array.isArray(data?.rows) && data.rows.length ? data.rows[0] : null
      setStockPreview(row)
    } catch {
      setStockPreview(null)
    } finally {
      setStockPreviewLoading(false)
    }
  }, [modal, form.pond_id, form.production_cycle_id, form.fish_species])

  useEffect(() => {
    if (!modal) {
      setStockPreview(null)
      return
    }
    const t = window.setTimeout(() => void refreshStockPreview(), 200)
    return () => window.clearTimeout(t)
  }, [modal, refreshStockPreview])

  const computedAvgWeightKg = useMemo(
    () => computeAvgWeightKg(form.estimated_fish_count, form.estimated_total_weight_kg),
    [form.estimated_fish_count, form.estimated_total_weight_kg],
  )

  const computedPcsPerKg = useMemo(() => {
    const n = parseInt(form.estimated_fish_count, 10)
    const w = Number(String(form.estimated_total_weight_kg).replace(/,/g, ''))
    if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(w) || w <= 0) return null
    return n / w
  }, [form.estimated_fish_count, form.estimated_total_weight_kg])

  const modalGrowthPreview = useMemo(() => {
    if (!form.pond_id || computedAvgWeightKg == null || !form.sample_date) {
      return { pcsPerKg: computedPcsPerKg, adg: null, days: null, prevDate: null }
    }
    const cycleKey = form.production_cycle_id ? form.production_cycle_id : 'none'
    const groupKey = `${form.pond_id}:${cycleKey}`
    const sampleDay = form.sample_date.split('T')[0]
    const priorSamples = rows
      .filter((r) => sampleGroupKey(r) === groupKey && r.id !== editing?.id)
      .filter((r) => r.sample_date.split('T')[0] <= sampleDay)
      .sort((a, b) => {
        const byDate = a.sample_date.localeCompare(b.sample_date)
        return byDate !== 0 ? byDate : a.id - b.id
      })
    const prev = priorSamples.length > 0 ? priorSamples[priorSamples.length - 1] : null
    if (!prev) {
      return { pcsPerKg: computedPcsPerKg, adg: null, days: null, prevDate: null }
    }
    const prevMean = displayAvgWeightKg(prev)
    if (prevMean == null || prevMean <= 0) {
      return {
        pcsPerKg: computedPcsPerKg,
        adg: null,
        days: daysBetweenSampleDates(prev.sample_date, form.sample_date),
        prevDate: prev.sample_date.split('T')[0],
      }
    }
    const days = daysBetweenSampleDates(prev.sample_date, form.sample_date)
    const adg = ((computedAvgWeightKg - prevMean) * 1000) / days
    return {
      pcsPerKg: computedPcsPerKg,
      adg,
      days,
      prevDate: prev.sample_date.split('T')[0],
    }
  }, [
    form.pond_id,
    form.production_cycle_id,
    form.sample_date,
    computedAvgWeightKg,
    computedPcsPerKg,
    rows,
    editing,
  ])

  const modalExtrapolation = useMemo(() => {
    const n = parseInt(form.estimated_fish_count, 10)
    const w = Number(String(form.estimated_total_weight_kg).replace(/,/g, ''))
    if (!Number.isFinite(n) || n <= 0 || !Number.isFinite(w) || w <= 0) return null
    return extrapolationPreview(n, w, stockPreview)
  }, [form.estimated_fish_count, form.estimated_total_weight_kg, stockPreview])

  const refreshValuationPreview = useCallback(async () => {
    const pid = form.pond_id
    const price = parseNum(form.market_price_per_kg)
    const biomass = modalExtrapolation?.biomassKg ?? null
    if (!modal || !pid || !form.sample_date || price == null || price <= 0 || biomass == null || biomass <= 0) {
      setValuationPreview(null)
      return
    }
    setValuationPreviewLoading(true)
    try {
      const params: Record<string, string> = {
        pond_id: pid,
        sample_date: form.sample_date,
        extrapolated_biomass_kg: String(biomass),
        market_price_per_kg: String(price),
      }
      if (form.production_cycle_id) params.production_cycle_id = form.production_cycle_id
      const { data } = await api.get<ValuationPreview>('/aquaculture/samples/valuation-preview/', { params })
      setValuationPreview(data)
    } catch {
      setValuationPreview(null)
    } finally {
      setValuationPreviewLoading(false)
    }
  }, [modal, form.pond_id, form.sample_date, form.production_cycle_id, form.market_price_per_kg, modalExtrapolation])

  useEffect(() => {
    if (!modal) {
      setValuationPreview(null)
      return
    }
    const t = window.setTimeout(() => void refreshValuationPreview(), 300)
    return () => window.clearTimeout(t)
  }, [modal, refreshValuationPreview])

  const refreshLoadAdvicePreview = useCallback(async () => {
    const pid = form.pond_id
    const biomass = modalExtrapolation?.biomassKg ?? null
    const heads = modalExtrapolation?.refHead ?? null
    if (!modal || !pid || biomass == null || biomass <= 0 || heads == null || heads <= 0) {
      setLoadAdvicePreview(null)
      return
    }
    const sampleCount = parseInt(form.estimated_fish_count, 10)
    const sampleKg = Number(String(form.estimated_total_weight_kg).replace(/,/g, ''))
    const fishPerKg =
      Number.isFinite(sampleCount) && sampleCount > 0 && Number.isFinite(sampleKg) && sampleKg > 0
        ? sampleCount / sampleKg
        : null
    setLoadAdviceLoading(true)
    try {
      const params: Record<string, string> = {
        pond_id: pid,
        extrapolated_biomass_kg: String(biomass),
        fish_count: String(heads),
      }
      if (fishPerKg != null && fishPerKg > 0) params.fish_per_kg = String(fishPerKg)
      const { data } = await api.get<LoadAdvicePreview>('/aquaculture/samples/load-advice-preview/', { params })
      setLoadAdvicePreview(data)
    } catch {
      setLoadAdvicePreview(null)
    } finally {
      setLoadAdviceLoading(false)
    }
  }, [modal, form.pond_id, form.estimated_fish_count, form.estimated_total_weight_kg, modalExtrapolation])

  useEffect(() => {
    if (!modal) {
      setLoadAdvicePreview(null)
      return
    }
    const t = window.setTimeout(() => void refreshLoadAdvicePreview(), 250)
    return () => window.clearTimeout(t)
  }, [modal, refreshLoadAdvicePreview])

  const openNew = () => {
    setEditing(null)
    const today = localDateISO()
    setForm({
      pond_id: ponds[0] ? String(ponds[0].id) : '',
      production_cycle_id: '',
      sample_date: today,
      fish_species: 'tilapia',
      fish_species_other: '',
      estimated_fish_count: '',
      estimated_total_weight_kg: '',
      market_price_per_kg: '',
      notes: '',
    })
    setModal(true)
  }

  const openEdit = (r: SampleRow) => {
    setEditing(r)
    setForm({
      pond_id: String(r.pond_id),
      production_cycle_id: r.production_cycle_id != null ? String(r.production_cycle_id) : '',
      sample_date: r.sample_date.slice(0, 10),
      fish_species: r.fish_species || 'tilapia',
      fish_species_other: r.fish_species_other || '',
      estimated_fish_count: r.estimated_fish_count != null ? String(r.estimated_fish_count) : '',
      estimated_total_weight_kg: r.estimated_total_weight_kg || '',
      market_price_per_kg: r.market_price_per_kg || '',
      notes: r.notes || '',
    })
    setModal(true)
  }

  const save = async () => {
    if (!form.pond_id || !form.sample_date) {
      toast.error(aquacultureT('errPondDateRequired', lang))
      return
    }
    const n = parseInt(form.estimated_fish_count, 10)
    if (!Number.isFinite(n) || n <= 0) {
      toast.error(aquacultureT('errFishCountPositive', lang))
      return
    }
    const x = Number(String(form.estimated_total_weight_kg).replace(/,/g, ''))
    if (!Number.isFinite(x) || x <= 0) {
      toast.error(aquacultureT('errWeightRequired', lang))
      return
    }
    const payload: Record<string, unknown> = {
      pond_id: parseInt(form.pond_id, 10),
      sample_date: form.sample_date,
      fish_species: form.fish_species,
      notes: form.notes.trim(),
      estimated_fish_count: n,
      estimated_total_weight_kg: x,
    }
    if (form.fish_species === 'other') {
      payload.fish_species_other = form.fish_species_other.trim()
    }
    const autoAvg = computeAvgWeightKg(form.estimated_fish_count, form.estimated_total_weight_kg)
    payload.avg_weight_kg = autoAvg !== null ? autoAvg : null
    const mpp = parseNum(form.market_price_per_kg)
    payload.market_price_per_kg = mpp != null && mpp > 0 ? mpp : null
    if (editing) {
      payload.production_cycle_id = form.production_cycle_id ? parseInt(form.production_cycle_id, 10) : null
    } else if (form.production_cycle_id) {
      payload.production_cycle_id = parseInt(form.production_cycle_id, 10)
    }
    try {
      if (editing) {
        await api.put(`/aquaculture/samples/${editing.id}/`, payload)
        toast.success(aquacultureT('updated', lang))
      } else {
        await api.post('/aquaculture/samples/', payload)
        toast.success(aquacultureT('saved', lang))
      }
      setModal(false)
      void loadRows()
    } catch (e) {
      toast.error(extractErrorMessage(e, aquacultureT('saveFailed', lang)))
    }
  }

  const remove = async (r: SampleRow) => {
    if (!window.confirm(aquacultureT('confirmDeleteSample', lang))) return
    try {
      await api.delete(`/aquaculture/samples/${r.id}/`)
      toast.success(aquacultureT('deleted', lang))
      void loadRows()
    } catch (e) {
      toast.error(extractErrorMessage(e, aquacultureT('deleteFailed', lang)))
    }
  }

  return (
    <AquaculturePageShell
      titleId="aq-sampling-title"
      eyebrow={pageMeta.eyebrow}
      title={pageMeta.title}
      titleIcon={Gauge}
      description={pageMeta.description}
      actions={
        <>
          <label className="text-xs font-medium text-teal-100">
            {aquacultureT('pondFilter', lang)}
            <select
              className="mt-1 block rounded-lg border border-white/20 bg-white/10 px-2 py-1.5 text-sm text-white"
              value={filterPond}
              onChange={(e) => setFilterPond(e.target.value)}
            >
              <option value="">{aquacultureT('allPonds', lang)}</option>
              {activePonds.map((p) => (
                <option key={p.id} value={p.id}>
                  {pondLabel(p)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void loadRows()} className={AQ_HERO_BTN_GHOST}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {aquacultureT('refresh', lang)}
          </button>
          <button
            type="button"
            onClick={openNew}
            disabled={loading || ponds.length === 0}
            className={AQ_HERO_BTN_PRIMARY}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {aquacultureT('logSample', lang)}
          </button>
        </>
      }
    >
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex gap-3">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" aria-hidden />
          <div className="min-w-0 flex-1 space-y-4 text-sm text-slate-700">
            <div>
              <p className="font-semibold text-slate-900">{aquacultureT('fieldGuideTitle', lang)}</p>
              <p className="mt-1 leading-relaxed">{aquacultureT('fieldGuideBody', lang)}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
                <p className="text-xs font-semibold text-teal-900">{aquacultureT('stepNetSample', lang)}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  {aquacultureT('stepNetSampleExample', lang)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
                <p className="text-xs font-semibold text-teal-900">{aquacultureT('stepPondTotal', lang)}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">
                  {aquacultureT('stepPondTotalExample', lang)}
                </p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
                <p className="text-xs font-semibold text-teal-900">{aquacultureT('stepLoadHarvest', lang)}</p>
                <p className="mt-1 text-xs leading-relaxed text-slate-600">{aquacultureT('stepLoadHarvestBody', lang)}</p>
              </div>
            </div>
            <p className="text-xs leading-relaxed text-slate-500">
              {aquacultureT('bookFiguresNote', lang)}{' '}
              <Link href="/aquaculture/stock" className="font-medium text-teal-800 underline hover:text-teal-950">
                {aquacultureT('pondStock', lang)}
              </Link>
              .
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="mt-10 flex justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-teal-600" />
        </div>
      ) : ponds.length === 0 ? (
        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-5 text-sm text-amber-950">
          <p className="font-medium">{aquacultureT('addPondFirstTitle', lang)}</p>
          <p className="mt-1 text-amber-900/90">{aquacultureT('addPondFirstBody', lang)}</p>
          <Link
            href="/aquaculture/ponds"
            className="mt-3 inline-block font-medium text-teal-800 underline decoration-teal-600/50 hover:decoration-teal-800"
          >
            {aquacultureT('goToPonds', lang)}
          </Link>
        </div>
      ) : (
        <div className="mt-6 w-full min-w-0 rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-left" aria-labelledby="aq-sampling-title">
            <caption className="sr-only">Aquaculture net samples and pond biomass extrapolation</caption>
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th scope="col" className={thMain}>
                  {aquacultureT('colWhen', lang)}
                  <span className={thSub}>{aquacultureT('colWhenSub', lang)}</span>
                </th>
                <th scope="col" className={thMain}>
                  {aquacultureT('colWhere', lang)}
                  <span className={thSub}>{aquacultureT('colWhereSub', lang)}</span>
                </th>
                <th scope="col" className={`${thMain} min-w-[8.5rem]`}>
                  {aquacultureT('colMeasured', lang)}
                  <span className={thSub}>{aquacultureT('colMeasuredSub', lang)}</span>
                </th>
                <th scope="col" className={`${thMain} min-w-[7.5rem]`}>
                  {aquacultureT('colSizeGrowth', lang)}
                  <span className={thSub}>{aquacultureT('colSizeGrowthSub', lang)}</span>
                </th>
                <th scope="col" className={`${thMain} min-w-[8rem]`}>
                  {aquacultureT('colBooks', lang)}
                  <span className={thSub}>{aquacultureT('colBooksSub', lang)}</span>
                </th>
                <th scope="col" className={`${thMain} min-w-[9rem]`}>
                  {aquacultureT('colPondEst', lang)}
                  <span className={thSub}>{aquacultureT('colPondEstSub', lang)}</span>
                </th>
                <th scope="col" className={`${thMain} min-w-[8rem]`}>
                  {aquacultureT('colMarket', lang)}
                  <span className={thSub}>{aquacultureT('colMarketSub', lang)}</span>
                </th>
                <th scope="col" className={`${thMain} min-w-[9.5rem]`}>
                  {aquacultureT('shouldYouThin', lang)}
                  <span className={thSub}>{aquacultureT('loadPerDecimalHarvest', lang)}</span>
                </th>
                <th scope="col" className={`${thMain} w-14`}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const avgKg = displayAvgWeightKg(r)
                const bookHead = r.stock_reference_fish_count
                const bookMean = parseNum(r.stock_reference_avg_weight_kg)
                const estBio = parseNum(r.extrapolated_biomass_kg)
                const estGain = parseNum(r.biomass_gain_kg)
                const mktPrice = parseNum(r.market_price_per_kg)
                const mktValue = parseNum(r.market_value)
                const bioMargin = parseNum(r.bioasset_margin)
                const fullMargin = parseNum(r.full_cycle_margin)
                const load = harvestAdviceLines(r, lang)
                const growth = growthBySampleId.get(r.id)
                const species = r.fish_species_label || r.fish_species || ''
                const cycle = r.production_cycle_name?.trim()
                const notes = (r.notes || '').trim()
                return (
                  <tr key={r.id} className="hover:bg-slate-50/50">
                    <td className={tdCell}>
                      <div className="text-xs font-medium text-slate-900">{formatDateOnly(r.sample_date)}</div>
                      {r.source_fish_sale_id != null ? (
                        <span className="mt-1 inline-block rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                          {aquacultureT('fromHarvestSale', lang)}
                        </span>
                      ) : null}
                    </td>
                    <td className={tdCell}>
                      <div className="text-xs font-semibold text-slate-900">{r.pond_name}</div>
                      {species ? <div className="text-[11px] text-slate-600">{species}</div> : null}
                      {cycle ? <div className="text-[11px] text-slate-500">{cycle}</div> : null}
                      {notes ? (
                        <div className="mt-1 text-[11px] leading-snug text-slate-500" title={notes}>
                          Note: {notes.length > 40 ? `${notes.slice(0, 37)}…` : notes}
                        </div>
                      ) : null}
                    </td>
                    <td className={tdCell}>
                      <MetricCell
                        lines={[
                          {
                            label: aquacultureT('inTheNetLabel', lang),
                            value:
                              r.estimated_fish_count != null && r.estimated_total_weight_kg != null
                                ? `${formatNumber(r.estimated_fish_count, 0)} ${aquacultureT('fishUnit', lang)} · ${formatNumber(Number(r.estimated_total_weight_kg))} kg`
                                : '—',
                          },
                          {
                            label: aquacultureT('avgPerFishLabel', lang),
                            value: avgKg != null ? `${formatMeanKgPerFish(avgKg)} ${aquacultureT('kgEach', lang)}` : '—',
                          },
                        ]}
                      />
                    </td>
                    <td className={tdCell}>
                      <MetricCell
                        lines={[
                          {
                            label: aquacultureT('pcsPerKgLabel', lang),
                            value:
                              growth?.pcsPerKg != null
                                ? `${formatNumber(growth.pcsPerKg, 1)} ${aquacultureT('fishPerKg', lang)}`
                                : '—',
                          },
                          {
                            label: aquacultureT('adgLabel', lang),
                            value:
                              growth?.adgGPerFishPerDay != null && Number.isFinite(growth.adgGPerFishPerDay)
                                ? `${formatNumber(growth.adgGPerFishPerDay, 2)} ${aquacultureT('adgUnit', lang)}${
                                    growth.daysSincePrev != null
                                      ? ` · ${growth.daysSincePrev} ${aquacultureT('daysShort', lang)}`
                                      : ''
                                  }`
                                : growth?.prevSampleDate
                                  ? aquacultureT('adgNeedsBothSamples', lang)
                                  : aquacultureT('firstSampleInBatch', lang),
                            valueClass:
                              growth?.adgGPerFishPerDay == null
                                ? 'text-slate-500'
                                : growth.adgGPerFishPerDay >= 0
                                  ? 'text-emerald-800'
                                  : 'text-rose-800',
                          },
                          ...(growth?.prevSampleDate
                            ? [
                                {
                                  label: aquacultureT('sinceLabel', lang),
                                  value: formatDateOnly(growth.prevSampleDate),
                                },
                              ]
                            : []),
                        ]}
                      />
                    </td>
                    <td className={tdCell}>
                      <MetricCell
                        lines={[
                          {
                            label: aquacultureT('fishInBooksLabel', lang),
                            value:
                              bookHead != null && bookHead > 0
                                ? `${formatNumber(bookHead, 0)} ${aquacultureT('headUnit', lang)}`
                                : '—',
                          },
                          {
                            label: aquacultureT('bookAvgWeight', lang),
                            value: bookMean != null ? `${formatMeanKgPerFish(bookMean)} ${aquacultureT('kgEach', lang)}` : '—',
                          },
                        ]}
                      />
                    </td>
                    <td className={tdCell}>
                      <MetricCell
                        lines={[
                          {
                            label: aquacultureT('estimatedInPond', lang),
                            value: estBio != null ? `${formatNumber(estBio)} ${aquacultureT('kgTotal', lang)}` : '—',
                            valueClass: 'font-semibold',
                          },
                          {
                            label: aquacultureT('changeVsBooks', lang),
                            value:
                              estGain != null
                                ? `${estGain >= 0 ? '+' : ''}${formatNumber(estGain)} kg (${aquacultureT('grewOrShrunk', lang)})`
                                : '—',
                            valueClass:
                              estGain == null ? '' : estGain >= 0 ? 'text-emerald-800' : 'text-rose-800',
                          },
                        ]}
                      />
                    </td>
                    <td className={tdCell}>
                      {mktPrice != null || mktValue != null ? (
                        <MetricCell
                          lines={[
                            {
                              label: aquacultureT('marketPrice', lang),
                              value: mktPrice != null ? `${formatMoney(mktPrice)} BDT/kg` : '—',
                            },
                            {
                              label: aquacultureT('valueAtMarket', lang),
                              value: mktValue != null ? `${formatMoney(mktValue)} BDT` : '—',
                            },
                            ...(bioMargin != null
                              ? [
                                  {
                                    label: aquacultureT('profitVsBio', lang),
                                    value: `${formatMoney(bioMargin)} BDT`,
                                    valueClass: marginClass(bioMargin),
                                  },
                                ]
                              : []),
                            ...(fullMargin != null
                              ? [
                                  {
                                    label: aquacultureT('profitVsFullCost', lang),
                                    value: `${formatMoney(fullMargin)} BDT`,
                                    valueClass: marginClass(fullMargin),
                                  },
                                ]
                              : []),
                          ]}
                        />
                      ) : (
                        <span className="text-xs text-slate-400">{aquacultureT('noMarketPrice', lang)}</span>
                      )}
                    </td>
                    <td className={tdCell} title={load.title}>
                      <MetricCell lines={load.lines} />
                    </td>
                    <td className={tdCell}>
                      <div className="flex flex-col items-end gap-0.5">
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                          title={aquacultureT('editSample', lang)}
                        >
                          <Pen className="h-3.5 w-3.5" aria-hidden />
                          <span className="sr-only">Edit</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => void remove(r)}
                          className="rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                          title={aquacultureT('deleteSample', lang)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          <span className="sr-only">Delete</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-500">
                    {aquacultureT('noSamplesYet', lang)}{' '}
                    <span className="font-medium text-slate-700">{aquacultureT('logSample', lang)}</span>.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-slate-900">
              {editing ? aquacultureT('editNetSample', lang) : aquacultureT('logSample', lang)}
            </h2>
            {editing?.source_fish_sale_id != null ? (
              <p className="mt-2 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs leading-relaxed text-teal-950">
                {aquacultureT('harvestSaleEditNote', lang)}
              </p>
            ) : null}

            <ol className="mt-4 list-decimal space-y-1.5 pl-5 text-xs text-slate-600">
              <li>{aquacultureT('modalStep1', lang)}</li>
              <li>{aquacultureT('modalStep2', lang)}</li>
              <li>{aquacultureT('modalStep3', lang)}</li>
            </ol>

            <div className="mt-4 space-y-3">
              <label className="block text-sm font-medium text-slate-700">
                {aquacultureT('pondFilter', lang)}
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.pond_id}
                  onChange={(e) => setForm((f) => ({ ...f, pond_id: e.target.value }))}
                >
                  {activePonds.map((p) => (
                    <option key={p.id} value={p.id}>
                      {pondLabel(p)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                {aquacultureT('stockingBatchOptional', lang)}
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.production_cycle_id}
                  onChange={(e) => setForm((f) => ({ ...f, production_cycle_id: e.target.value }))}
                >
                  <option value="">{aquacultureT('allMovementsPond', lang)}</option>
                  {cycles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                {aquacultureT('sampleDate', lang)}
                <CompanyDateInput
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.sample_date}
                  onChange={(isoYmd) => setForm((f) => ({ ...f, sample_date: isoYmd }))}
                  required
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                {aquacultureT('fishSpecies', lang)}
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.fish_species}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      fish_species: e.target.value,
                      fish_species_other: e.target.value === 'other' ? f.fish_species_other : '',
                    }))
                  }
                >
                  {speciesOptionsForSampling.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              {form.fish_species === 'other' ? (
                <label className="block text-sm font-medium text-slate-700">
                  {aquacultureT('otherSpeciesName', lang)}
                  <input
                    type="text"
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                    value={form.fish_species_other}
                    onChange={(e) => setForm((f) => ({ ...f, fish_species_other: e.target.value }))}
                    placeholder="e.g. local strain"
                  />
                </label>
              ) : null}

              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  {aquacultureT('fishStockRefLive', lang)}
                </p>
                {stockPreviewLoading ? (
                  <p className="mt-2 text-sm text-slate-500">{aquacultureT('loadingPosition', lang)}</p>
                ) : stockPreview ? (
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-slate-500">{aquacultureT('impliedHead', lang)}</dt>
                      <dd className="font-medium tabular-nums text-slate-900">
                        {stockPreview.implied_net_fish_count > 0
                          ? formatNumber(stockPreview.implied_net_fish_count, 0)
                          : '—'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">{aquacultureT('impliedNetKg', lang)}</dt>
                      <dd className="font-medium tabular-nums text-slate-900">
                        {formatNumber(Number(stockPreview.implied_net_weight_kg))}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">{aquacultureT('couldNotLoadPosition', lang)}</p>
                )}
                <p className="mt-2 text-xs leading-relaxed text-slate-500">{aquacultureT('stockRefHint', lang)}</p>
              </div>

              <label className="block text-sm font-medium text-slate-700">
                {aquacultureT('fishInNetCount', lang)} <span className="text-rose-600">*</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.estimated_fish_count}
                  onChange={(e) => setForm((f) => ({ ...f, estimated_fish_count: e.target.value }))}
                  placeholder="e.g. 20"
                />
              </label>
              <label className="block text-sm font-medium text-slate-700">
                {aquacultureT('combinedWeightKg', lang)} <span className="text-rose-600">*</span>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.estimated_total_weight_kg}
                  onChange={(e) => setForm((f) => ({ ...f, estimated_total_weight_kg: e.target.value }))}
                  placeholder="e.g. 5"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="block text-sm font-medium text-slate-700">
                  {aquacultureT('sampleMeanWeight', lang)}
                  <div
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800 tabular-nums"
                    aria-live="polite"
                  >
                    {computedAvgWeightKg != null ? formatNumber(computedAvgWeightKg) : '—'}
                  </div>
                </div>
                <div className="block text-sm font-medium text-slate-700">
                  {aquacultureT('pcsPerKgFromNet', lang)}
                  <div
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800 tabular-nums"
                    aria-live="polite"
                  >
                    {modalGrowthPreview.pcsPerKg != null ? formatNumber(modalGrowthPreview.pcsPerKg, 1) : '—'}
                  </div>
                </div>
              </div>
              {modalGrowthPreview.prevDate ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {aquacultureT('growthVsLastSample', lang)}
                  </p>
                  <p className="mt-1 tabular-nums text-slate-800">
                    {modalGrowthPreview.adg != null && Number.isFinite(modalGrowthPreview.adg)
                      ? `${formatNumber(modalGrowthPreview.adg, 2)} ${aquacultureT('adgUnit', lang)} · ${modalGrowthPreview.days ?? '—'} ${aquacultureT('daysShort', lang)} ${aquacultureT('sinceLabel', lang)} ${formatDateOnly(modalGrowthPreview.prevDate)}`
                      : `${aquacultureT('adgUnavailable', lang)} ${formatDateOnly(modalGrowthPreview.prevDate)}`}
                  </p>
                </div>
              ) : computedPcsPerKg != null ? (
                <p className="text-xs text-slate-500">{aquacultureT('firstSampleAdgHint', lang)}</p>
              ) : null}

              {modalExtrapolation ? (
                <div className="rounded-lg border border-teal-100 bg-teal-50/60 p-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-teal-900">
                    {aquacultureT('previewBeforeSave', lang)}
                  </p>
                  <dl className="mt-2 space-y-1.5">
                    <div className="flex justify-between gap-2">
                      <dt className="text-teal-900/80">{aquacultureT('bookMeanKgFish', lang)}</dt>
                      <dd className="tabular-nums font-medium text-teal-950">
                        {modalExtrapolation.refAvgKg != null ? formatMeanKgPerFish(modalExtrapolation.refAvgKg) : '—'}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-teal-900/80">{aquacultureT('estPondBiomass', lang)}</dt>
                      <dd className="tabular-nums font-medium text-teal-950">
                        {modalExtrapolation.biomassKg != null ? `${formatNumber(modalExtrapolation.biomassKg)} kg` : '—'}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-teal-900/80">{aquacultureT('estBiomassVsBook', lang)}</dt>
                      <dd
                        className={`tabular-nums font-medium ${
                          modalExtrapolation.gainKg == null
                            ? 'text-teal-950'
                            : modalExtrapolation.gainKg >= 0
                              ? 'text-emerald-800'
                              : 'text-rose-800'
                        }`}
                      >
                        {modalExtrapolation.gainKg != null ? `${formatNumber(modalExtrapolation.gainKg)} kg` : '—'}
                      </dd>
                    </div>
                  </dl>
                  {modalExtrapolation.refHead == null || modalExtrapolation.refHead <= 0 ? (
                    <p className="mt-2 text-xs text-amber-800">{aquacultureT('noHeadForExtrap', lang)}</p>
                  ) : null}
                </div>
              ) : null}

              {loadAdviceLoading ? (
                <p className="text-sm text-slate-500">{aquacultureT('computingLoadAdvice', lang)}</p>
              ) : loadAdvicePreview ? (
                <PartialHarvestAdvicePanel row={loadAdvicePreview} />
              ) : null}

              <label className="block text-sm font-medium text-slate-700">
                {aquacultureT('marketPriceOptional', lang)}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  value={form.market_price_per_kg}
                  onChange={(e) => setForm((f) => ({ ...f, market_price_per_kg: e.target.value }))}
                  placeholder="e.g. 180"
                />
              </label>
              <p className="-mt-1 text-xs text-slate-500">
                Optional. When set, the app compares estimated pond market value to bio-asset book value and full pond
                costs.
              </p>

              {valuationPreviewLoading ? (
                <p className="text-sm text-slate-500">Computing valuation…</p>
              ) : valuationPreview ? (
                <div className="rounded-lg border border-violet-200 bg-violet-50/70 p-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-violet-950">Valuation preview</p>
                  <dl className="mt-2 space-y-1.5">
                    <div className="flex justify-between gap-2">
                      <dt className="text-violet-900/80">Market value (est.)</dt>
                      <dd className="tabular-nums font-medium text-violet-950">
                        {formatMoney(parseNum(valuationPreview.market_value))} BDT
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-violet-900/80">Book bio-asset</dt>
                      <dd className="tabular-nums font-medium text-violet-950">
                        {formatMoney(parseNum(valuationPreview.book_bioasset_value))} BDT
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-violet-900/80">Margin vs bio-asset</dt>
                      <dd
                        className={`tabular-nums font-medium ${marginClass(parseNum(valuationPreview.bioasset_margin))}`}
                      >
                        {formatMoney(parseNum(valuationPreview.bioasset_margin))} BDT
                        {valuationPreview.bioasset_margin_per_kg ? (
                          <span className="ml-1 text-xs text-violet-800/80">
                            ({formatMoney(parseNum(valuationPreview.bioasset_margin_per_kg))}/kg)
                          </span>
                        ) : null}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-violet-900/80">Full cost base (P&amp;L)</dt>
                      <dd className="tabular-nums font-medium text-violet-950">
                        {formatMoney(parseNum(valuationPreview.full_cost_base))} BDT
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-violet-900/80">Margin vs full cost</dt>
                      <dd
                        className={`tabular-nums font-medium ${marginClass(parseNum(valuationPreview.full_cycle_margin))}`}
                      >
                        {formatMoney(parseNum(valuationPreview.full_cycle_margin))} BDT
                        {valuationPreview.full_cycle_margin_per_kg ? (
                          <span className="ml-1 text-xs text-violet-800/80">
                            ({formatMoney(parseNum(valuationPreview.full_cycle_margin_per_kg))}/kg)
                          </span>
                        ) : null}
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : parseNum(form.market_price_per_kg) != null && parseNum(form.market_price_per_kg)! > 0 ? (
                <p className="text-xs text-amber-800">
                  Enter sample fish count and weight with positive Fish stock head count to preview valuation.
                </p>
              ) : null}

              <label className="block text-sm font-medium text-slate-700">
                {aquacultureT('notes', lang)}
                <textarea
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="Gear type, weather, crew, etc."
                />
              </label>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setModal(false)} className="rounded-lg px-3 py-2 text-sm text-slate-600 hover:bg-slate-100">
                {t('cancel')}
              </button>
              <button type="button" onClick={() => void save()} className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white">
                {t('save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </AquaculturePageShell>
  )
}
