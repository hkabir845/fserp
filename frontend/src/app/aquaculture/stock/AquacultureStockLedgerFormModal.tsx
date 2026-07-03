'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Beaker,
  BookOpen,
  ChevronDown,
  Fish,
  Loader2,
  MapPin,
  Scale,
  X,
} from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { useT, type I18nKey } from '@/lib/i18n'
import { extractErrorMessage } from '@/utils/errorHandler'
import { getCurrencySymbol, formatNumber } from '@/utils/currency'
import { MODAL_BACKDROP, MODAL_FORM_PANEL } from '@/lib/modalLayout'

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
export interface LedgerRow {
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

type FormState = {
  pond_id: string
  production_cycle_id: string
  entry_kind: string
  loss_reason: string
  fish_species: string
  fish_species_other: string
  entry_date: string
  fish_removed: string
  fish_per_kg: string
  kg_removed: string
  adj_fish_count: string
  adj_weight_kg: string
  book_value: string
  post_to_books: boolean
  memo: string
}

interface LastSampleReference {
  sample_id: number
  sample_date: string
  estimated_fish_count: number | null
  estimated_total_weight_kg: string | null
  fish_per_kg: string
  fish_species_label?: string
  avg_weight_kg?: string | null
}

interface BioCostReference {
  cost_per_kg: string
  cost_per_fish?: string | null
  live_fish_count?: number
  basis_note?: string
  biological_cost_total?: string
  denominator_kg?: string
  on_hand_weight_kg?: string
  bio_asset_balance?: string
  book_cost_per_kg?: string | null
  method?: string
}

type Props = {
  open: boolean
  editing: LedgerRow | null
  ponds: Pond[]
  refData: ReferencePayload | null
  fishSpecies: RefOpt[]
  currency: string
  defaultPondId?: string
  defaultCycleId?: string
  defaultSpecies?: string
  onClose: () => void
  onSaved: () => void
}

const inputCls =
  'w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm text-foreground shadow-sm focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:border-border disabled:bg-muted/40 disabled:text-muted-foreground'
const labelCls = 'block text-xs font-semibold uppercase tracking-wide text-muted-foreground'

function deriveFishPerKg(count: number, kg: number): string {
  if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(kg) || kg <= 0) return ''
  return String(Math.round((count / kg) * 100) / 100)
}

/** total kg = |fish count| ÷ fish per kg; preserves sign for adjustments when signed=true */
function kgFromFishCountAndPerKg(countStr: string, fishPerKgStr: string, signed = false): string {
  const c = parseInt(countStr, 10)
  const fpk = Number(String(fishPerKgStr).replace(/,/g, ''))
  if (!Number.isFinite(c) || c === 0 || !Number.isFinite(fpk) || fpk <= 0) return ''
  const kg = Math.abs(c) / fpk
  const rounded = Math.round(kg * 10000) / 10000
  const s = String(rounded)
  if (signed && c < 0) return `-${s.replace(/^-/, '')}`
  return s
}

function ledgerPrefillScopeKey(
  pondId: string,
  cycleId: string,
  species: string,
  speciesOther: string,
): string {
  return `${pondId}|${cycleId}|${species}|${species === 'other' ? speciesOther : ''}`
}

function QuantityFromSampleFields({
  lastSample,
  lastSampleLoading,
  fishPerKg,
  fishCount,
  weightKg,
  onFishPerKgChange,
  onFishCountChange,
  onWeightKgChange,
  onReapplySample,
  fishCountLabel,
  fishCountHint,
  weightLabel,
  weightHint,
  fishCountPlaceholder = 'e.g. 250',
  weightPlaceholder = 'e.g. 4.5',
  t,
}: {
  lastSample: LastSampleReference | null
  lastSampleLoading: boolean
  fishPerKg: string
  fishCount: string
  weightKg: string
  onFishPerKgChange: (v: string) => void
  onFishCountChange: (v: string) => void
  onWeightKgChange: (v: string) => void
  onReapplySample: () => void
  fishCountLabel: string
  fishCountHint: string
  weightLabel: string
  weightHint?: string
  fishCountPlaceholder?: string
  weightPlaceholder?: string
  t: (key: I18nKey) => string
}) {
  return (
    <div className="mt-4 space-y-3">
      {lastSampleLoading ? (
        <p className="text-xs text-muted-foreground">{t('stockLoadingLastSample')}</p>
      ) : lastSample ? (
        <div className="flex flex-wrap items-start gap-2 rounded-lg border border-violet-200 bg-violet-50/80 px-3 py-2.5 text-xs text-violet-950">
          <Beaker className="mt-0.5 h-4 w-4 shrink-0 text-violet-700" aria-hidden />
          <div className="min-w-0 flex-1">
            <p>
              <span className="font-medium">{t('stockLastSample')}</span> {formatDateOnly(lastSample.sample_date)}
              {lastSample.fish_species_label ? ` · ${lastSample.fish_species_label}` : ''}:{' '}
              <span className="tabular-nums">
                {lastSample.estimated_fish_count != null
                  ? `${formatNumber(lastSample.estimated_fish_count, 0)} ${t('stockFish')}`
                  : '—'}
                {lastSample.estimated_total_weight_kg
                  ? ` · ${formatNumber(Number(lastSample.estimated_total_weight_kg), 2)} kg`
                  : ''}
                {' · '}
                {formatNumber(Number(lastSample.fish_per_kg), 2)} fish/kg
              </span>
            </p>
            <button
              type="button"
              onClick={onReapplySample}
              className="mt-1 font-medium text-violet-900 underline hover:text-violet-950"
            >
              {t('stockReapplySample')}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('stockNoSampleHint')}</p>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className={labelCls}>
            {fishCountLabel} <span className="text-destructive">*</span>
          </span>
          <input
            className={`${inputCls} mt-1.5`}
            inputMode="numeric"
            placeholder={fishCountPlaceholder}
            value={fishCount}
            onChange={(e) => onFishCountChange(e.target.value)}
          />
          <span className="mt-1 block text-xs text-muted-foreground">{fishCountHint}</span>
        </label>
        <label className="block">
          <span className={labelCls}>
            {weightLabel} <span className="text-destructive">*</span>
          </span>
          <input
            className={`${inputCls} mt-1.5`}
            inputMode="decimal"
            placeholder={weightPlaceholder}
            value={weightKg}
            onChange={(e) => onWeightKgChange(e.target.value)}
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            {weightHint ?? t('stockTotalBiomassHint')}
          </span>
        </label>
        <label className="block">
          <span className={labelCls}>
            {t('stockFishPerKg')} <span className="text-destructive">*</span>
          </span>
          <input
            className={`${inputCls} mt-1.5`}
            inputMode="decimal"
            placeholder={t('stockFishPerKgAutoPh')}
            value={fishPerKg}
            onChange={(e) => onFishPerKgChange(e.target.value)}
          />
          <span className="mt-1 block text-xs text-muted-foreground">{t('stockFishPerKgHint')}</span>
        </label>
      </div>
    </div>
  )
}

function emptyForm(
  ponds: Pond[],
  defaultPondId?: string,
  defaultSpecies?: string,
  defaultCycleId?: string,
): FormState {
  const today = new Date().toISOString().slice(0, 10)
  const pond =
    defaultPondId && ponds.some((p) => String(p.id) === defaultPondId)
      ? defaultPondId
      : ponds[0]
        ? String(ponds[0].id)
        : ''
  const species =
    defaultSpecies && defaultSpecies.trim() !== '' ? defaultSpecies.trim() : 'tilapia'
  return {
    pond_id: pond,
    production_cycle_id: defaultCycleId?.trim() || '',
    entry_kind: 'loss',
    loss_reason: 'mortality',
    fish_species: species,
    fish_species_other: '',
    entry_date: today,
    fish_removed: '',
    fish_per_kg: '',
    kg_removed: '',
    adj_fish_count: '',
    adj_weight_kg: '',
    book_value: '0',
    post_to_books: false,
    memo: '',
  }
}

function formFromRow(r: LedgerRow): FormState {
  const loss = r.entry_kind === 'loss'
  const fcd = r.fish_count_delta
  const wkd = Number(r.weight_kg_delta)
  return {
    pond_id: String(r.pond_id),
    production_cycle_id: r.production_cycle_id != null ? String(r.production_cycle_id) : '',
    entry_kind: r.entry_kind,
    loss_reason: (r.loss_reason || 'mortality').trim() || 'mortality',
    fish_species: (r.fish_species || 'tilapia').trim() || 'tilapia',
    fish_species_other: (r.fish_species_other || '').trim(),
    entry_date: r.entry_date.slice(0, 10),
    fish_removed: loss && fcd < 0 ? String(Math.abs(fcd)) : '',
    kg_removed: loss && wkd < 0 ? String(Math.abs(wkd)) : '',
    fish_per_kg:
      loss && fcd < 0 && wkd < 0
        ? deriveFishPerKg(Math.abs(fcd), Math.abs(wkd))
        : !loss && fcd !== 0 && wkd !== 0
          ? deriveFishPerKg(Math.abs(fcd), Math.abs(wkd))
          : '',
    adj_fish_count: !loss && fcd !== 0 ? String(fcd) : '',
    adj_weight_kg: !loss && wkd !== 0 ? String(wkd) : '',
    book_value: r.book_value || '',
    post_to_books: r.post_to_books,
    memo: r.memo || '',
  }
}

export function AquacultureStockLedgerFormModal({
  open,
  editing,
  ponds,
  refData,
  fishSpecies,
  currency,
  defaultPondId,
  defaultCycleId,
  defaultSpecies,
  onClose,
  onSaved,
}: Props) {
  const toast = useToast()
  const { t } = useT()
  const sym = getCurrencySymbol(currency)
  const isEdit = editing != null
  const glLinked = Boolean(editing?.journal_entry_id)
  const bookPostingLocked = isEdit

  const [form, setForm] = useState<FormState>(() =>
    emptyForm(ponds, defaultPondId, defaultSpecies, defaultCycleId),
  )
  const isMortalityLoss = form.entry_kind === 'loss'
  const [cycles, setCycles] = useState<CycleRow[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [bioCost, setBioCost] = useState<BioCostReference | null>(null)
  const [bioCostLoading, setBioCostLoading] = useState(false)
  const [lastSample, setLastSample] = useState<LastSampleReference | null>(null)
  const [lastSampleLoading, setLastSampleLoading] = useState(false)
  const [bookValueTouched, setBookValueTouched] = useState(false)
  const [fishPerKgTouched, setFishPerKgTouched] = useState(false)
  const [debouncedSpeciesOther, setDebouncedSpeciesOther] = useState('')
  const prevOpenRef = useRef(false)
  const quantitiesDirtyRef = useRef(false)
  const prefScopeRef = useRef('')
  const prevPrefillScopeRef = useRef('')

  const markQuantitiesDirty = useCallback(() => {
    quantitiesDirtyRef.current = true
  }, [])

  useEffect(() => {
    if (!open) {
      setDebouncedSpeciesOther('')
      return
    }
    const t = window.setTimeout(() => setDebouncedSpeciesOther(form.fish_species_other.trim()), 400)
    return () => window.clearTimeout(t)
  }, [open, form.fish_species_other])

  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setForm(
        editing ? formFromRow(editing) : emptyForm(ponds, defaultPondId, defaultSpecies, defaultCycleId),
      )
      setBookValueTouched(false)
      setFishPerKgTouched(false)
      quantitiesDirtyRef.current = false
      prefScopeRef.current = ''
      prevPrefillScopeRef.current = ''
      setBioCost(null)
      setLastSample(null)
    }
    prevOpenRef.current = open
  }, [open, editing, ponds, defaultPondId, defaultSpecies, defaultCycleId])

  const prefillScope = ledgerPrefillScopeKey(
    form.pond_id,
    form.production_cycle_id,
    form.fish_species,
    debouncedSpeciesOther,
  )

  useEffect(() => {
    if (!open) return
    if (prevPrefillScopeRef.current === prefillScope) return
    prevPrefillScopeRef.current = prefillScope
    quantitiesDirtyRef.current = false
    prefScopeRef.current = ''
    setBookValueTouched(false)
    setFishPerKgTouched(false)
  }, [open, prefillScope])

  useEffect(() => {
    if (!open) return
    prefScopeRef.current = ''
  }, [open, form.entry_kind])

  useEffect(() => {
    if (!open || glLinked || bookPostingLocked || !form.pond_id || !form.fish_species) {
      setLastSample(null)
      setLastSampleLoading(false)
      return
    }
    const ac = new AbortController()
    setLastSampleLoading(true)
    void (async () => {
      try {
        const params: Record<string, string> = {
          pond_id: form.pond_id,
          fish_species: form.fish_species,
        }
        if (form.production_cycle_id) params.production_cycle_id = form.production_cycle_id
        if (form.fish_species === 'other' && debouncedSpeciesOther) {
          params.fish_species_other = debouncedSpeciesOther
        }
        const { data } = await api.get<{ found: boolean } & Partial<LastSampleReference>>(
          '/aquaculture/biomass-samples/last-reference/',
          { params, signal: ac.signal },
        )
        if (data?.found && data.fish_per_kg) {
          setLastSample(data as LastSampleReference)
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
  }, [
    open,
    glLinked,
    bookPostingLocked,
    form.pond_id,
    form.production_cycle_id,
    form.fish_species,
    debouncedSpeciesOther,
  ])

  useEffect(() => {
    if (!open || glLinked || bookPostingLocked || !form.pond_id) {
      setBioCost(null)
      setBioCostLoading(false)
      return
    }
    const ac = new AbortController()
    setBioCostLoading(true)
    void (async () => {
      try {
        const params: Record<string, string> = {
          pond_id: form.pond_id,
        }
        if (form.production_cycle_id) params.production_cycle_id = form.production_cycle_id
        if (form.entry_date) params.as_of = form.entry_date
        const { data } = await api.get<{ found: boolean } & Partial<BioCostReference>>(
          '/aquaculture/fish-stock/bio-cost-reference/',
          { params, signal: ac.signal },
        )
        if (data?.found && data.cost_per_kg) {
          setBioCost(data as BioCostReference)
        } else {
          setBioCost(null)
        }
      } catch {
        if (!ac.signal.aborted) setBioCost(null)
      } finally {
        if (!ac.signal.aborted) setBioCostLoading(false)
      }
    })()
    return () => ac.abort()
  }, [
    open,
    glLinked,
    bookPostingLocked,
    form.pond_id,
    form.production_cycle_id,
    form.entry_date,
  ])

  const applySamplePrefill = useCallback((ref: LastSampleReference, entryKind: string) => {
    const count =
      ref.estimated_fish_count != null && ref.estimated_fish_count > 0
        ? String(ref.estimated_fish_count)
        : ''
    const kg = ref.estimated_total_weight_kg?.trim() || ''
    const kgResolved =
      kg ||
      (entryKind === 'loss'
        ? kgFromFishCountAndPerKg(count, ref.fish_per_kg, false)
        : kgFromFishCountAndPerKg(count, ref.fish_per_kg, true))
    const countN = parseInt(count, 10)
    const kgN = Number(String(kgResolved).replace(/,/g, ''))
    const derivedFpk = deriveFishPerKg(Math.abs(countN), Math.abs(kgN)) || ref.fish_per_kg
    setFishPerKgTouched(false)
    setForm((f) => {
      if (entryKind === 'loss') {
        return {
          ...f,
          fish_removed: count || f.fish_removed,
          kg_removed: kgResolved || f.kg_removed,
          fish_per_kg: derivedFpk,
        }
      }
      return {
        ...f,
        adj_fish_count: count || f.adj_fish_count,
        adj_weight_kg: kgResolved || f.adj_weight_kg,
        fish_per_kg: derivedFpk,
      }
    })
  }, [])

  useEffect(() => {
    if (!open || glLinked || bookPostingLocked || !lastSample) return
    if (quantitiesDirtyRef.current) return
    if (prefScopeRef.current === prefillScope) return
    prefScopeRef.current = prefillScope
    applySamplePrefill(lastSample, form.entry_kind)
  }, [
    open,
    glLinked,
    bookPostingLocked,
    lastSample,
    prefillScope,
    form.entry_kind,
    applySamplePrefill,
  ])

  useEffect(() => {
    if (!open || !form.pond_id) {
      setCycles([])
      return
    }
    void (async () => {
      try {
        const { data } = await api.get<CycleRow[]>('/aquaculture/production-cycles/', {
          params: { pond_id: form.pond_id },
        })
        setCycles(Array.isArray(data) ? data : [])
      } catch {
        setCycles([])
      }
    })()
  }, [open, form.pond_id])

  useEffect(() => {
    if (glLinked || bookPostingLocked || fishPerKgTouched) return
    if (form.entry_kind === 'loss') {
      const count = parseInt(form.fish_removed, 10)
      const kg = Number(String(form.kg_removed).replace(/,/g, ''))
      const fpk = deriveFishPerKg(count, kg)
      if (!fpk) return
      setForm((f) => (f.fish_per_kg === fpk ? f : { ...f, fish_per_kg: fpk }))
      return
    }
    const count = parseInt(form.adj_fish_count, 10)
    const kg = Number(String(form.adj_weight_kg).replace(/,/g, ''))
    const fpk = deriveFishPerKg(Math.abs(count), Math.abs(kg))
    if (!fpk) return
    setForm((f) => (f.fish_per_kg === fpk ? f : { ...f, fish_per_kg: fpk }))
  }, [
    form.entry_kind,
    form.fish_removed,
    form.kg_removed,
    form.adj_fish_count,
    form.adj_weight_kg,
    glLinked,
    bookPostingLocked,
    fishPerKgTouched,
  ])

  const applyLastSampleQuantities = () => {
    if (!lastSample) return
    quantitiesDirtyRef.current = false
    prefScopeRef.current = prefillScope
    const count =
      lastSample.estimated_fish_count != null && lastSample.estimated_fish_count > 0
        ? String(lastSample.estimated_fish_count)
        : ''
    const kg = lastSample.estimated_total_weight_kg?.trim() || ''
    const kgResolved =
      kg ||
      (form.entry_kind === 'loss'
        ? kgFromFishCountAndPerKg(count, lastSample.fish_per_kg, false)
        : kgFromFishCountAndPerKg(count, lastSample.fish_per_kg, true))
    const countN = parseInt(count, 10)
    const kgN = Number(String(kgResolved).replace(/,/g, ''))
    const derivedFpk =
      deriveFishPerKg(Math.abs(countN), Math.abs(kgN)) || lastSample.fish_per_kg
    setFishPerKgTouched(false)
    setForm((f) => {
      if (f.entry_kind === 'loss') {
        return {
          ...f,
          fish_removed: count,
          kg_removed: kgResolved,
          fish_per_kg: derivedFpk,
        }
      }
      return {
        ...f,
        adj_fish_count: count,
        adj_weight_kg: kgResolved,
        fish_per_kg: derivedFpk,
      }
    })
  }

  const weightKgForBook = useMemo(() => {
    if (glLinked || bookPostingLocked) return null
    if (form.entry_kind === 'loss') {
      const kg = Number(String(form.kg_removed).replace(/,/g, ''))
      return Number.isFinite(kg) && kg > 0 ? kg : null
    }
    const kg = Number(String(form.adj_weight_kg).replace(/,/g, ''))
    return Number.isFinite(kg) && kg !== 0 ? Math.abs(kg) : null
  }, [form.entry_kind, form.kg_removed, form.adj_weight_kg, glLinked, bookPostingLocked])

  const suggestedBookValue = useMemo(() => {
    if (!bioCost?.cost_per_kg || weightKgForBook == null) return null
    const p = Number(bioCost.cost_per_kg)
    if (!Number.isFinite(p) || p <= 0) return null
    let amt = Math.round(weightKgForBook * p * 100) / 100
    const bal = bioCost.bio_asset_balance != null ? Number(bioCost.bio_asset_balance) : null
    if (bal != null && Number.isFinite(bal) && bal > 0 && amt > bal) {
      amt = bal
    }
    return amt.toFixed(2)
  }, [bioCost, weightKgForBook])

  useEffect(() => {
    if (bookValueTouched || glLinked || bookPostingLocked || suggestedBookValue == null) return
    if (isMortalityLoss) return
    setForm((f) => (f.book_value === suggestedBookValue ? f : { ...f, book_value: suggestedBookValue }))
  }, [suggestedBookValue, bookValueTouched, glLinked, bookPostingLocked, isMortalityLoss])

  useEffect(() => {
    if (bookValueTouched || glLinked || bookPostingLocked || !isMortalityLoss) return
    setForm((f) =>
      f.book_value === '0' && !f.post_to_books ? f : { ...f, book_value: '0', post_to_books: false },
    )
  }, [isMortalityLoss, bookValueTouched, glLinked, bookPostingLocked, form.entry_kind])

  const applyBioCostBookValue = () => {
    if (suggestedBookValue == null) return
    setForm((f) => ({ ...f, book_value: suggestedBookValue }))
    setBookValueTouched(false)
  }

  const preview = useMemo(() => {
    if (glLinked) return null
    if (form.entry_kind === 'loss') {
      const heads = parseInt(form.fish_removed, 10)
      const kg = Number(String(form.kg_removed).replace(/,/g, ''))
      if (!Number.isFinite(heads) || heads <= 0 || !Number.isFinite(kg) || kg <= 0) return null
      return { fish: -heads, kg: -Math.abs(kg) }
    }
    if (form.adj_fish_count.trim() === '' || form.adj_weight_kg.trim() === '') return null
    const fish = parseInt(form.adj_fish_count, 10)
    const kg = Number(String(form.adj_weight_kg).replace(/,/g, ''))
    if (!Number.isFinite(fish) || fish === 0 || !Number.isFinite(kg) || kg === 0) return null
    return { fish, kg }
  }, [form, glLinked])

  const buildBody = (): Record<string, unknown> | null => {
    const pond_id = parseInt(form.pond_id, 10)
    if (!Number.isFinite(pond_id)) {
      toast.error(t('stockSelectPond'))
      return null
    }
    let fish_count_delta = 0
    let weight_kg_delta = 0
    if (form.entry_kind === 'loss') {
      const hr = parseInt(form.fish_removed, 10)
      if (!Number.isFinite(hr) || hr <= 0) {
        toast.error(t('stockEnterFishRemoved'))
        return null
      }
      fish_count_delta = -Math.abs(hr)
      const kg = Number(String(form.kg_removed).replace(/,/g, ''))
      if (!Number.isFinite(kg) || kg <= 0) {
        toast.error(t('stockEnterWeightRemoved'))
        return null
      }
      weight_kg_delta = -Math.abs(kg)
    } else {
      if (form.adj_fish_count.trim() === '') {
        toast.error(t('stockFishCountRequired'))
        return null
      }
      fish_count_delta = parseInt(form.adj_fish_count, 10)
      if (!Number.isFinite(fish_count_delta) || fish_count_delta === 0) {
        toast.error(t('stockFishCountNonZero'))
        return null
      }
      if (form.adj_weight_kg.trim() === '') {
        toast.error(t('stockWeightRequired'))
        return null
      }
      weight_kg_delta = Number(String(form.adj_weight_kg).replace(/,/g, ''))
      if (!Number.isFinite(weight_kg_delta) || weight_kg_delta === 0) {
        toast.error(t('stockWeightNonZero'))
        return null
      }
    }
    const body: Record<string, unknown> = {
      pond_id,
      entry_date: form.entry_date,
      entry_kind: form.entry_kind,
      loss_reason: form.entry_kind === 'loss' ? form.loss_reason : '',
      fish_species: form.fish_species,
      fish_species_other: form.fish_species_other,
      fish_count_delta,
      weight_kg_delta,
      book_value: form.book_value.trim() === '' ? '0' : form.book_value,
      post_to_books: form.post_to_books,
      memo: form.memo,
    }
    if (form.production_cycle_id) body.production_cycle_id = parseInt(form.production_cycle_id, 10)
    else body.production_cycle_id = null
    return body
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      if (editing?.journal_entry_id) {
        await api.put(`/aquaculture/fish-stock-ledger/${editing.id}/`, { memo: form.memo })
        toast.success(t('stockMemoUpdated'))
        onSaved()
        onClose()
        return
      }
      const body = buildBody()
      if (!body) return
      if (editing) {
        await api.put(`/aquaculture/fish-stock-ledger/${editing.id}/`, body)
        toast.success(t('stockEntryUpdated'))
      } else {
        await api.post('/aquaculture/fish-stock-ledger/', body)
        toast.success(t('stockEntrySaved'))
      }
      onSaved()
      onClose()
    } catch (e) {
      toast.error(extractErrorMessage(e, t('stockSaveFailed')))
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  const entryKinds = refData?.entry_kind ?? [
    { id: 'loss', label: t('stockEntryLoss') },
    { id: 'adjustment', label: t('stockEntryAdjustment') },
  ]
  const lossReasons = refData?.loss_reason ?? []

  return (
    <div
      className={MODAL_BACKDROP}
      role="dialog"
      aria-modal="true"
      aria-labelledby="aq-stock-ledger-form-title"
    >
      <div className={MODAL_FORM_PANEL}>
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-gradient-to-r from-teal-50 to-card px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id="aq-stock-ledger-form-title" className="text-xl font-bold tracking-tight text-foreground">
              {glLinked ? t('stockEditMemo') : isEdit ? t('stockEditEntry') : t('stockRecordEntry')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {glLinked
                ? t('stockGlPostedHint')
                : isEdit
                  ? t('stockEditHint')
                  : t('stockCreateHint')}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-muted disabled:opacity-50"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {glLinked ? (
            <div className="mb-5 flex gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-foreground" aria-hidden />
              <p>
                Biological amounts and GL are locked. Use <strong className="font-medium">Rollback</strong> in the
                table to reverse this entry and its journal together.
              </p>
            </div>
          ) : isEdit && !glLinked ? (
            <p className="mb-5 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Book value and “Post journal” were set at creation. To change GL posting, roll back this row and add a new
              one.
            </p>
          ) : null}

          {!glLinked && !isEdit ? (
            <details className="group mb-5 overflow-hidden rounded-xl border border-border bg-muted/50">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-foreground marker:content-none [&::-webkit-details-marker]:hidden">
                <ChevronDown
                  className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                  aria-hidden
                />
                <BookOpen className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                Example: 500 fish mortality with GL posting
              </summary>
              <div className="border-t border-border px-4 py-3 text-sm leading-relaxed text-foreground/85">
                <p className="text-muted-foreground">
                  Morning check: ~500 dead tilapia. Recent sampling suggests ~4 fish/kg. You want stock, P&amp;L, and
                  account <strong className="font-medium text-foreground">1581</strong> updated.
                </p>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-xs sm:text-sm">
                  <li>
                    <strong className="font-medium text-foreground">Where &amp; when:</strong> pick the grow pond, today&apos;s
                    date, optional stocking batch, species Tilapia.
                  </li>
                  <li>
                    <strong className="font-medium text-foreground">What happened:</strong> entry type{' '}
                    <span className="rounded bg-rose-50 px-1 font-medium text-rose-900">Loss</span>, reason Mortality,
                    fish removed <span className="tabular-nums">500</span>, fish/kg{' '}
                    <span className="tabular-nums">4</span> → kg removed{' '}
                    <span className="tabular-nums">125</span> (preview: −500 fish · −125 kg).
                  </li>
                  <li>
                    <strong className="font-medium text-foreground">Book value:</strong> if cost/kg is {sym}120, book value
                    ≈ {sym}15,000 (125 × 120, capped at pond bio-asset balance). Check{' '}
                    <strong className="font-medium text-foreground">Post journal on save</strong> to post Dr{' '}
                    <span className="tabular-nums">6726</span> / Cr <span className="tabular-nums">1581</span>.
                  </li>
                  <li>
                    <strong className="font-medium text-foreground">Memo:</strong> e.g. &quot;Morning mortality after low DO —
                    ~500 fish, est. 125 kg @ 4 fish/kg&quot;.
                  </li>
                </ol>
                <p className="mt-3 text-xs text-muted-foreground">
                  <strong className="font-medium text-muted-foreground">After save:</strong> implied pond stock drops; biomass
                  sampling uses lower book head; P&amp;L shows biological write-off when book value is set; GL moves only
                  when posted. Stock-only (no GL): enter fish + kg, leave book value at 0 and Post journal unchecked.
                </p>
              </div>
            </details>
          ) : null}

          {!glLinked && preview ? (
            <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-primary/25 bg-accent/80 px-4 py-3">
              <Fish className="h-5 w-5 text-primary" aria-hidden />
              <div className="text-sm text-teal-950">
                <span className="font-medium">Stock impact preview:</span>{' '}
                <span className="tabular-nums">
                  {preview.fish > 0 ? '+' : ''}
                  {formatNumber(preview.fish, 0)} fish
                </span>
                {' · '}
                <span className="tabular-nums">
                  {preview.kg > 0 ? '+' : ''}
                  {formatNumber(preview.kg, 2)} kg
                </span>
              </div>
            </div>
          ) : null}

          <section className="rounded-xl border border-border bg-muted/40/60 p-4 sm:p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <MapPin className="h-4 w-4 text-primary" aria-hidden />
              Where &amp; when
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block sm:col-span-1">
                <span className={labelCls}>
                  Pond <span className="text-destructive">*</span>
                </span>
                <select
                  className={`${inputCls} mt-1.5`}
                  value={form.pond_id}
                  disabled={glLinked}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, pond_id: e.target.value, production_cycle_id: '' }))
                  }
                >
                  {ponds.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block sm:col-span-1">
                <span className={labelCls}>Entry date</span>
                <input
                  type="date"
                  className={`${inputCls} mt-1.5`}
                  value={form.entry_date}
                  disabled={glLinked}
                  onChange={(e) => setForm((f) => ({ ...f, entry_date: e.target.value }))}
                />
              </label>
              <label className="block sm:col-span-2">
                <span className={labelCls}>Stocking batch (optional)</span>
                <select
                  className={`${inputCls} mt-1.5`}
                  value={form.production_cycle_id}
                  disabled={glLinked}
                  onChange={(e) => setForm((f) => ({ ...f, production_cycle_id: e.target.value }))}
                >
                  <option value="">Not specified — pond-level only</option>
                  {cycles.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {form.pond_id && cycles.length === 0 ? (
                  <p className="mt-1 text-xs text-warning-foreground">
                    No batches for this pond yet — pond-level mortality still works, or{' '}
                    <Link
                      href={`/aquaculture/cycles?pond_id=${encodeURIComponent(form.pond_id)}`}
                      className="font-medium text-primary underline hover:text-teal-950"
                    >
                      create a stocking batch
                    </Link>
                    .
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Tag a batch so this entry appears in batch × species breakdown and filtered totals. Same record as{' '}
                    <Link href="/aquaculture/cycles" className="font-medium text-primary underline hover:text-teal-950">
                      Stocking batches
                    </Link>
                    .
                  </p>
                )}
              </label>
              <label className="block sm:col-span-2">
                <span className={labelCls}>Fish species</span>
                <div className="mt-1.5 grid gap-3 sm:grid-cols-2">
                  <select
                    className={inputCls}
                    value={form.fish_species}
                    disabled={glLinked}
                    onChange={(e) => setForm((f) => ({ ...f, fish_species: e.target.value }))}
                  >
                    {(fishSpecies.length ? fishSpecies : [{ id: 'tilapia', label: 'Tilapia' }]).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {form.fish_species === 'other' ? (
                    <input
                      className={inputCls}
                      placeholder="Species name"
                      value={form.fish_species_other}
                      disabled={glLinked}
                      onChange={(e) => setForm((f) => ({ ...f, fish_species_other: e.target.value }))}
                    />
                  ) : null}
                </div>
              </label>
            </div>
          </section>

          {!glLinked ? (
            <section className="mt-5 rounded-xl border border-border bg-white p-4 sm:p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Scale className="h-4 w-4 text-primary" aria-hidden />
                What happened
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Loss entries always reduce stock. Adjustments can increase or decrease count and weight.
              </p>

              <div className="mt-4">
                <span className={labelCls}>Entry type</span>
                <div className="mt-2 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Entry type">
                  {entryKinds.map((o) => {
                    const active = form.entry_kind === o.id
                    return (
                      <button
                        key={o.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => setForm((f) => ({ ...f, entry_kind: o.id }))}
                        className={`rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                          active
                            ? 'border-teal-600 bg-accent font-medium text-teal-950 ring-2 ring-teal-500/30'
                            : 'border-border bg-white text-foreground/85 hover:border-border hover:bg-muted/40'
                        }`}
                      >
                        <span className="block font-semibold">{o.label}</span>
                        <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                          {o.id === 'loss'
                            ? t('stockLossKindsHint')
                            : t('stockAdjKindsHint')}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>

              {form.entry_kind === 'loss' ? (
                <>
                  {lossReasons.length > 0 ? (
                    <div className="mt-4">
                      <span className={labelCls}>Loss reason</span>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {lossReasons.map((o) => {
                          const active = form.loss_reason === o.id
                          return (
                            <button
                              key={o.id}
                              type="button"
                              onClick={() => setForm((f) => ({ ...f, loss_reason: o.id }))}
                              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                                active
                                  ? 'border-teal-600 bg-primary text-white'
                                  : 'border-border bg-white text-foreground/85 hover:border-border'
                              }`}
                            >
                              {o.label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                  <QuantityFromSampleFields
                    lastSample={lastSample}
                    lastSampleLoading={lastSampleLoading}
                    fishPerKg={form.fish_per_kg}
                    fishCount={form.fish_removed}
                    weightKg={form.kg_removed}
                    onFishPerKgChange={(v) => {
                      markQuantitiesDirty()
                      setFishPerKgTouched(true)
                      setForm((f) => ({ ...f, fish_per_kg: v }))
                    }}
                    onFishCountChange={(v) => {
                      markQuantitiesDirty()
                      setForm((f) => ({ ...f, fish_removed: v }))
                    }}
                    onWeightKgChange={(v) => {
                      markQuantitiesDirty()
                      setForm((f) => ({ ...f, kg_removed: v }))
                    }}
                    onReapplySample={applyLastSampleQuantities}
                    fishCountLabel={t('stockFishCountHeads')}
                    fishCountHint={t('stockHeadsLost')}
                    weightLabel={t('stockTotalWeightKg')}
                    t={t}
                  />
                </>
              ) : (
                <QuantityFromSampleFields
                  lastSample={lastSample}
                  lastSampleLoading={lastSampleLoading}
                  fishPerKg={form.fish_per_kg}
                  fishCount={form.adj_fish_count}
                  weightKg={form.adj_weight_kg}
                  onFishPerKgChange={(v) => {
                    markQuantitiesDirty()
                    setFishPerKgTouched(true)
                    setForm((f) => ({ ...f, fish_per_kg: v }))
                  }}
                  onFishCountChange={(v) => {
                    markQuantitiesDirty()
                    setForm((f) => ({ ...f, adj_fish_count: v }))
                  }}
                  onWeightKgChange={(v) => {
                    markQuantitiesDirty()
                    setForm((f) => ({ ...f, adj_weight_kg: v }))
                  }}
                  onReapplySample={applyLastSampleQuantities}
                  fishCountLabel={t('stockFishCountDelta')}
                  fishCountHint={t('stockFishCountDeltaHint')}
                  weightLabel={t('stockWeightDeltaKg')}
                  weightHint={t('stockWeightSignHint')}
                  fishCountPlaceholder="e.g. -120 or +50000"
                  t={t}
                />
              )}
            </section>
          ) : null}

          {!glLinked && !bookPostingLocked ? (
            <section className="mt-5 rounded-xl border border-border bg-muted/40/60 p-4 sm:p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <BookOpen className="h-4 w-4 text-primary" aria-hidden />
                {t('stockGlOptional')}
              </div>
              {refData?.coa_note ? (
                <p className="mt-1 text-xs text-muted-foreground">{refData.coa_note}</p>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">{t('stockGlHint')}</p>
              )}
              <div className="mt-4 space-y-3">
                {isMortalityLoss ? (
                  <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning-foreground">
                    <p className="font-medium">Mortality — cost stays on survivors</p>
                    <p className="mt-1 leading-snug">
                      Leave book value at <span className="font-semibold">0</span> so accumulated fry, feed, and pond
                      costs redistribute over the remaining live fish. Only enter a book value if you need a GL
                      write-down (Dr 6726 / Cr 1581).
                    </p>
                    {bioCost?.cost_per_fish ? (
                      <p className="mt-2 tabular-nums text-warning-foreground">
                        Current survivor cost:{' '}
                        <span className="font-semibold">
                          {sym}
                          {formatNumber(Number(bioCost.cost_per_fish), 2)}/fish
                        </span>
                        {bioCost.cost_per_kg ? (
                          <>
                            {' '}
                            · {sym}
                            {formatNumber(Number(bioCost.cost_per_kg), 2)}/kg
                          </>
                        ) : null}
                        {bioCost.live_fish_count != null ? (
                          <> · {formatNumber(bioCost.live_fish_count, 0)} live fish</>
                        ) : null}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {bioCostLoading ? (
                  <p className="text-xs text-muted-foreground">Looking up production cost for this pond…</p>
                ) : bioCost ? (
                  <div className="rounded-lg border border-border bg-white px-3 py-2.5 text-xs text-muted-foreground">
                    <p>
                      <span className="font-medium text-foreground">Production cost</span>{' '}
                      {bioCost.cost_per_fish ? (
                        <>
                          <span className="tabular-nums font-medium text-foreground">
                            {sym}
                            {formatNumber(Number(bioCost.cost_per_fish), 2)}/fish
                          </span>
                          {bioCost.cost_per_kg ? (
                            <span className="text-muted-foreground">
                              {' '}
                              · {sym}
                              {formatNumber(Number(bioCost.cost_per_kg), 2)}/kg
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="tabular-nums font-medium text-foreground">
                          {sym}
                          {formatNumber(Number(bioCost.cost_per_kg), 2)}/kg
                        </span>
                      )}
                      <span className="text-muted-foreground"> (fry + feed + medicine + preparation)</span>
                    </p>
                    {bioCost.basis_note ? (
                      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{bioCost.basis_note}</p>
                    ) : null}
                    {!isMortalityLoss && weightKgForBook != null && suggestedBookValue ? (
                      <p className="mt-1 tabular-nums text-foreground/85">
                        Suggested bio-asset amount for {formatNumber(weightKgForBook, 2)} kg:{' '}
                        <span className="font-semibold text-primary">
                          {sym}
                          {formatNumber(Number(suggestedBookValue), 2)}
                        </span>
                        {bookValueTouched ? (
                          <button
                            type="button"
                            onClick={applyBioCostBookValue}
                            className="ml-2 font-medium text-primary underline hover:text-teal-950"
                          >
                            Re-apply from cost/kg
                          </button>
                        ) : null}
                      </p>
                    ) : !isMortalityLoss ? (
                      <p className="mt-1 text-muted-foreground">
                        Enter weight — book value fills from accumulated production cost/kg.
                      </p>
                    ) : weightKgForBook != null && suggestedBookValue ? (
                      <p className="mt-1 tabular-nums text-foreground/85">
                        Optional GL write-down for {formatNumber(weightKgForBook, 2)} kg:{' '}
                        <span className="font-semibold">{sym}{formatNumber(Number(suggestedBookValue), 2)}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setForm((f) => ({
                              ...f,
                              book_value: suggestedBookValue,
                              post_to_books: true,
                            }))
                            setBookValueTouched(true)
                          }}
                          className="ml-2 font-medium text-primary underline hover:text-teal-950"
                        >
                          Apply GL write-down
                        </button>
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No production cost for this pond yet — enter book value manually if needed.
                  </p>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className={labelCls}>Book value ({sym})</span>
                  <input
                    className={`${inputCls} mt-1.5`}
                    inputMode="decimal"
                    placeholder={isMortalityLoss ? '0' : suggestedBookValue ?? '0'}
                    value={form.book_value}
                    onChange={(e) => {
                      setBookValueTouched(true)
                      setForm((f) => ({ ...f, book_value: e.target.value }))
                    }}
                  />
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {isMortalityLoss
                      ? 'Default 0 — accumulated cost remains on surviving fish unless you post a GL write-down.'
                      : 'Editable — override the suggested amount anytime.'}
                  </span>
                </label>
                <label className="flex items-end sm:col-span-1">
                  <span className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-white px-4 py-3 text-sm text-foreground/85 shadow-sm">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 rounded border-border text-primary focus:ring-teal-500"
                      checked={form.post_to_books}
                      onChange={(e) => setForm((f) => ({ ...f, post_to_books: e.target.checked }))}
                    />
                    <span>
                      <span className="font-medium text-foreground">Post journal on save</span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">Requires a non-zero book value</span>
                    </span>
                  </span>
                </label>
                </div>
              </div>
            </section>
          ) : null}

          <section className="mt-5 rounded-xl border border-border bg-white p-4 sm:p-5">
            <span className={labelCls}>Memo / notes</span>
            <textarea
              className={`${inputCls} mt-1.5`}
              rows={3}
              placeholder={
                glLinked
                  ? 'Update description for auditors or pond staff…'
                  : 'e.g. Morning mortality after low DO, partial harvest recount…'
              }
              value={form.memo}
              onChange={(e) => setForm((f) => ({ ...f, memo: e.target.value }))}
            />
          </section>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-muted/50 px-5 py-4 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-border bg-white px-4 py-2.5 text-sm font-medium text-foreground/85 shadow-sm hover:bg-muted/40 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || ponds.length === 0}
            className="inline-flex min-w-[7rem] items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {glLinked ? t('stockSaveMemo') : isEdit ? t('stockSaveChanges') : t('stockSaveEntry')}
          </button>
        </div>
      </div>
    </div>
  )
}
