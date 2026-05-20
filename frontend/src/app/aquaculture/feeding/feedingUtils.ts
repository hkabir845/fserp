/** Shared types and pure helpers for the feeding advice page. */

export const SACK_SIZE_OPTIONS_KG = [25, 20, 10] as const

export type AdviceStatusFilter = 'all' | 'pending_review' | 'approved' | 'applied' | 'cancelled'

export const STATUS_TABS: { id: AdviceStatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pending_review', label: 'Review' },
  { id: 'approved', label: 'Approved' },
  { id: 'applied', label: 'Applied' },
  { id: 'cancelled', label: 'Cancelled' },
]

export interface FeedingAdviceRow {
  id: number
  pond_id: number
  pond_name: string
  pond_default_feed_item_id?: number | null
  pond_default_feed_item_name?: string
  production_cycle_id: number | null
  production_cycle_name: string
  target_date: string
  status: string
  status_label: string
  pond_status_snapshot: Record<string, unknown>
  ai_advice_text: string
  edited_advice_text: string
  effective_advice_text: string
  suggested_feed_kg: string | null
  sack_size_kg?: number | null
  approved_at: string | null
  approved_by_display: string
  applied_feed_kg: string | null
  applied_at: string | null
  applied_by_display: string
  linked_expense_id: number | null
  linked_expense_category?: string
  created_by_display: string
  created_at: string
}

export interface MealPlanRow {
  mealIndex: number
  timePlain: string
  kg: string
}

export function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

export function stripMarkdownBold(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .trim()
}

export function isAllowedSackKg(n: number | null | undefined): n is (typeof SACK_SIZE_OPTIONS_KG)[number] {
  return n != null && (SACK_SIZE_OPTIONS_KG as readonly number[]).includes(n)
}

export function kgCellToSackCount(kgCell: string, sackKg: number): string {
  if (kgCell === '—') return '—'
  const n = Number.parseFloat(kgCell)
  if (!Number.isFinite(n) || n <= 0) return '—'
  return String(Math.round(n / sackKg))
}

export function totalKgToSackSummary(totalKgStr: string | null, sackKg: number | null): string | null {
  if (totalKgStr == null || sackKg == null || sackKg <= 0) return null
  const n = Number.parseFloat(totalKgStr)
  if (!Number.isFinite(n) || n <= 0) return null
  const sacks = Math.round(n / sackKg)
  return `≈ ${sacks} sacks (${sackKg} kg/sack)`
}

export function feedKgToSackLabel(kgStr: string | null | undefined, sackKg: number | null): string | null {
  if (kgStr == null || String(kgStr).trim() === '' || !isAllowedSackKg(sackKg)) return null
  return totalKgToSackSummary(String(kgStr).trim(), sackKg)
}

export function rowSackKg(r: FeedingAdviceRow | null): (typeof SACK_SIZE_OPTIONS_KG)[number] {
  if (!r) return 25
  return isAllowedSackKg(r.sack_size_kg) ? r.sack_size_kg : 25
}

export function sacksStrFromKg(kgStr: string, sackKg: number): string {
  const n = Number.parseFloat(kgStr)
  if (!Number.isFinite(n) || n < 0) return ''
  if (n === 0) return '0'
  return String(Math.round(n / sackKg))
}

export function kgStrFromSacks(sacksStr: string, sackKg: number): string {
  const n = Number.parseFloat(sacksStr)
  if (!Number.isFinite(n) || n < 0) return ''
  const sacks = Math.round(n)
  return (sacks * sackKg).toFixed(2)
}

export function feedInventoryQtyFromKgForEstimate(
  appliedKg: number,
  unit: string,
  contentWeightKg: string | null | undefined,
  sackSizeKg: number,
): number | null {
  const unitL = (unit || '').trim().toLowerCase()
  if (unitL === 'kg' || unitL === 'kilogram' || unitL === 'kilograms') {
    return appliedKg
  }
  let kgPer = contentWeightKg != null ? Number.parseFloat(String(contentWeightKg)) : Number.NaN
  if (!Number.isFinite(kgPer) || kgPer <= 0) {
    kgPer = sackSizeKg > 0 ? sackSizeKg : 25
  }
  if (kgPer <= 0) return null
  return appliedKg / kgPer
}

export function buildMealPlanRows(
  selected: FeedingAdviceRow | null,
  schedule: Record<string, unknown> | null,
  timeLines: string[],
): { rows: MealPlanRow[]; totalKg: string | null } {
  if (!selected) return { rows: [], totalKg: null }

  let perMeal: string[] = []
  if (schedule && Array.isArray(schedule.per_meal_feed_kg_approx)) {
    perMeal = (schedule.per_meal_feed_kg_approx as unknown[])
      .map((x) => String(x).trim())
      .filter((x) => x !== '')
  }

  const freq =
    typeof schedule?.frequency_meals_per_day === 'number' && schedule.frequency_meals_per_day > 0
      ? schedule.frequency_meals_per_day
      : 0

  const totalFromApi =
    schedule?.daily_feed_amount_kg != null && String(schedule.daily_feed_amount_kg).trim() !== ''
      ? String(schedule.daily_feed_amount_kg).trim()
      : selected.suggested_feed_kg

  const totalNum = totalFromApi != null ? Number.parseFloat(String(totalFromApi)) : NaN

  let nRows = Math.max(perMeal.length, timeLines.length, freq)
  if (perMeal.length === 0 && Number.isFinite(totalNum) && totalNum > 0 && nRows === 0) {
    nRows = 2
  }
  if (nRows === 0 && totalFromApi != null && Number.isFinite(totalNum) && totalNum > 0) {
    nRows = 1
    perMeal = [totalNum.toFixed(2)]
  } else if (perMeal.length === 0 && Number.isFinite(totalNum) && totalNum > 0 && nRows > 0) {
    const each = (totalNum / nRows).toFixed(2)
    perMeal = Array.from({ length: nRows }, () => each)
  }

  nRows = Math.max(nRows, perMeal.length, timeLines.length)
  if (nRows === 0) {
    return { rows: [], totalKg: null }
  }

  const rows: MealPlanRow[] = []
  for (let i = 0; i < nRows; i++) {
    const rawT = timeLines[i]
    rows.push({
      mealIndex: i + 1,
      timePlain:
        rawT != null && String(rawT).trim() !== '' ? stripMarkdownBold(String(rawT)) : '—',
      kg: perMeal[i] != null ? perMeal[i] : '—',
    })
  }

  let totalKg: string | null = null
  if (perMeal.length > 0) {
    const sum = perMeal.reduce((acc, x) => acc + (Number.parseFloat(x) || 0), 0)
    if (sum > 0) totalKg = sum.toFixed(2)
  }
  if (totalKg == null && totalFromApi != null) {
    const t = Number.parseFloat(String(totalFromApi))
    if (Number.isFinite(t) && t > 0) totalKg = t.toFixed(2)
  }

  return { rows, totalKg }
}

export function statusPill(status: string) {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium'
  if (status === 'pending_review') return `${base} bg-amber-100 text-amber-900`
  if (status === 'approved') return `${base} bg-sky-100 text-sky-900`
  if (status === 'applied') return `${base} bg-emerald-100 text-emerald-900`
  if (status === 'cancelled') return `${base} bg-slate-200 text-slate-700`
  return `${base} bg-slate-100 text-slate-800`
}

export function snapshotWorldfish(snap: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!snap || typeof snap !== 'object') return null
  const w = snap.worldfish
  return w && typeof w === 'object' ? (w as Record<string, unknown>) : null
}

export function snapshotFeedingHeuristic(snap: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!snap || typeof snap !== 'object') return null
  const h = snap.feeding_heuristic
  return h && typeof h === 'object' ? (h as Record<string, unknown>) : null
}

export function snapshotFeedingSchedule(snap: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!snap || typeof snap !== 'object') return null
  const fs = snap.feeding_schedule
  return fs && typeof fs === 'object' ? (fs as Record<string, unknown>) : null
}

export function mealsPerDayLabel(snap: Record<string, unknown> | undefined): string | null {
  const sched = snapshotFeedingSchedule(snap)
  const raw =
    (sched?.times_per_day as string | undefined) ||
    (snapshotWorldfish(snap)?.meals_hint as string | undefined)
  if (raw == null || String(raw).trim() === '') return null
  return String(raw).trim()
}

/** Structured dose lines for list cards — no truncation. */
export interface FeedingDoseParts {
  kgLine: string | null
  sackLine: string | null
  rateLine: string | null
  mealsLine: string | null
}

export function bwPercentFromRow(r: FeedingAdviceRow): string | null {
  const snap = r.pond_status_snapshot
  const heur = snapshotFeedingHeuristic(snap)
  const wf = snapshotWorldfish(snap)
  const raw =
    (heur?.body_weight_percent_per_day as string | undefined) ??
    (wf?.chosen_bw_pct_per_day as string | undefined)
  return raw != null && String(raw).trim() !== '' ? String(raw).trim() : null
}

export function feedingDoseParts(r: FeedingAdviceRow): FeedingDoseParts {
  const snap = r.pond_status_snapshot as Record<string, unknown> | undefined
  const pct = bwPercentFromRow(r)
  const meals = mealsPerDayLabel(snap)
  const sackKg = rowSackKg(r)

  let kgLine: string | null = null
  let sackLine: string | null = null

  if (r.status === 'applied' && r.applied_feed_kg) {
    kgLine = `${r.applied_feed_kg} kg applied`
    sackLine = feedKgToSackLabel(r.applied_feed_kg, sackKg)
  } else if (r.suggested_feed_kg) {
    kgLine = `${r.suggested_feed_kg} kg suggested`
    sackLine = feedKgToSackLabel(r.suggested_feed_kg, sackKg)
  }

  const rateLine = pct ? `${pct}% body weight / day` : null

  return { kgLine, sackLine, rateLine, mealsLine: meals }
}

export function feedingDoseListLabel(r: FeedingAdviceRow): string {
  const snap = r.pond_status_snapshot as Record<string, unknown> | undefined
  const wf = snapshotWorldfish(snap)
  const heur = snapshotFeedingHeuristic(snap)
  const pctRaw =
    (heur?.body_weight_percent_per_day as string | undefined) ??
    (wf?.chosen_bw_pct_per_day as string | undefined)
  const pct = pctRaw != null && String(pctRaw).trim() !== '' ? String(pctRaw).trim() : null
  const parts = feedingDoseParts(r)
  const bits = [parts.kgLine, parts.sackLine, parts.rateLine, parts.mealsLine].filter(Boolean)
  return bits.length > 0 ? bits.join(' · ') : '—'
}

export function workflowStepIndex(status: string): number {
  if (status === 'cancelled') return -1
  const order = ['pending_review', 'approved', 'applied'] as const
  return order.indexOf(status as (typeof order)[number])
}

export function primaryFeedKg(r: FeedingAdviceRow): string | null {
  if (r.status === 'applied' && r.applied_feed_kg) return r.applied_feed_kg
  return r.suggested_feed_kg
}
