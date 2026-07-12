/** Shared fish stock metrics: pcs/kg, load per decimal, partial harvest hints. */

import { formatQuantity } from '@/utils/quantity'

export type StockMetricsRow = {
  pond_id?: number
  pond_name?: string
  implied_net_weight_kg?: string
  /** Sample-based estimated biomass (preferred for display). */
  effective_net_weight_kg?: string
  /** Transaction book kg (fry in − transfers); may be negative on nursing ponds. */
  book_net_weight_kg?: string
  implied_net_fish_count?: number
  current_fish_per_kg?: string | null
  current_fish_per_kg_source?: string | null
  current_avg_weight_kg?: string | null
  stock_density_kg_per_decimal?: string | null
  stock_density_kg_per_1000_cu_ft?: string | null
  load_level?: string
  load_level_label?: string
  advice_summary?: string
  partial_harvest_applicable?: boolean
  partial_harvest_suggested_kg?: string | null
  partial_harvest_suggested_fish_count?: number | null
  partial_harvest_target_kg_per_decimal?: string | null
  partial_harvest_post_load_kg_per_decimal?: string | null
  partial_harvest_rationale?: string
  water_area_decimal?: string | null
}

/** Primary live biomass kg: estimated/effective first, then book. */
export function displayBiomassKg(row: StockMetricsRow | null | undefined): number {
  if (!row) return 0
  const eff = Number(row.effective_net_weight_kg)
  if (Number.isFinite(eff)) return eff
  const book = Number(row.book_net_weight_kg ?? row.implied_net_weight_kg)
  return Number.isFinite(book) ? book : 0
}

export function bookBiomassKg(row: StockMetricsRow | null | undefined): number | null {
  if (!row) return null
  const book = Number(row.book_net_weight_kg ?? row.implied_net_weight_kg)
  return Number.isFinite(book) ? book : null
}

export type FcrBlock = {
  period_start?: string
  period_end?: string
  methodology?: string
  portfolio?: {
    feed_kg?: string
    harvest_kg?: string
    biomass_gain_kg?: string
    fcr_biomass?: string | null
    fcr_harvest?: string | null
    biomass_gain_note?: string
  }
  scoped?: FcrBlock['portfolio']
  per_pond?: Array<{
    pond_id: number
    pond_name: string
    feed_kg?: string
    harvest_kg?: string
    biomass_gain_kg?: string
    fcr_biomass?: string | null
    fcr_harvest?: string | null
  }>
}

const LOAD_BADGE: Record<string, string> = {
  understocked: 'bg-sky-50 text-sky-900 border-sky-200',
  moderate: 'bg-emerald-50 text-emerald-900 border-emerald-200',
  full: 'bg-warning/10 text-warning-foreground border-warning/30',
  high_risk: 'bg-rose-50 text-rose-900 border-rose-200',
  unknown: 'bg-muted/40 text-foreground/85 border-border',
}

export function loadLevelBadgeClass(level: string | undefined): string {
  return LOAD_BADGE[level || 'unknown'] || LOAD_BADGE.unknown
}

export function formatKgPerDecimal(row: StockMetricsRow): string | null {
  const v = row.stock_density_kg_per_decimal
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? `${formatQuantity(n)} kg/dec` : null
}

export function formatPcsPerKg(row: StockMetricsRow): string | null {
  const v = row.current_fish_per_kg
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? `${formatQuantity(n)} pcs/kg` : null
}
