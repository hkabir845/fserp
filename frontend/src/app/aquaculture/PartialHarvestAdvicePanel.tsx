'use client'

import { Scissors } from 'lucide-react'
import { formatNumber } from '@/utils/currency'
import { useCompanyLocale } from '@/contexts/CompanyLocaleContext'
import { aquacultureT } from '@/lib/aquacultureI18n'
import {
  formatKgPerDecimal,
  formatPcsPerKg,
  loadLevelBadgeClass,
  type StockMetricsRow,
} from './aquacultureFishMetrics'

type Props = {
  row: StockMetricsRow
  compact?: boolean
  className?: string
}

/** Advisory partial-harvest hint when pond load is full or high — manager may adjust. */
export function PartialHarvestAdvicePanel({ row, compact, className = '' }: Props) {
  const { language: lang } = useCompanyLocale()
  const density = formatKgPerDecimal(row)
  const pcs = formatPcsPerKg(row)
  const applicable = row.partial_harvest_applicable === true
  const suggestKg = row.partial_harvest_suggested_kg
  const suggestHeads = row.partial_harvest_suggested_fish_count

  if (compact && !applicable) {
    return (
      <div className={`text-xs text-muted-foreground ${className}`}>
        {density ? <span className="tabular-nums font-medium">{density}</span> : null}
        {pcs ? <span className="ml-2 text-muted-foreground">{pcs}</span> : null}
      </div>
    )
  }

  return (
    <div
      className={`rounded-xl border p-4 ${
        applicable ? 'border-warning/30 bg-warning/10/60' : 'border-border bg-white'
      } ${className}`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {aquacultureT('pondLoad', lang)}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {row.load_level_label ? (
              <span
                className={`rounded-md border px-2 py-0.5 text-xs font-semibold ${loadLevelBadgeClass(row.load_level)}`}
              >
                {row.load_level_label}
              </span>
            ) : null}
            {density ? (
              <span className="text-lg font-semibold tabular-nums text-foreground">{density}</span>
            ) : (
              <span className="text-sm text-muted-foreground">{aquacultureT('setWaterAreaDecimal', lang)}</span>
            )}
          </div>
          {pcs ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {aquacultureT('currentSize', lang)}{' '}
              <span className="font-medium tabular-nums">{pcs}</span>
              {row.current_fish_per_kg_source ? (
                <span className="text-muted-foreground/70"> · {row.current_fish_per_kg_source}</span>
              ) : null}
            </p>
          ) : null}
          {row.implied_net_fish_count != null && row.implied_net_weight_kg ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {aquacultureT('liveStock', lang)}{' '}
              <span className="font-medium tabular-nums">
                {formatNumber(row.implied_net_fish_count, 0)} {aquacultureT('fish', lang)} ·{' '}
                {formatNumber(Number(row.implied_net_weight_kg), 2)} kg
              </span>
            </p>
          ) : null}
        </div>
        {applicable && suggestKg ? (
          <div className="shrink-0 rounded-lg border border-amber-300 bg-white px-3 py-2 shadow-sm">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-warning-foreground">
              <Scissors className="h-3.5 w-3.5" aria-hidden />
              {aquacultureT('suggestedPartialHarvest', lang)}
            </p>
            <p className="mt-1 text-base font-bold tabular-nums text-warning-foreground">
              {formatNumber(Number(suggestKg), 2)} kg
              {suggestHeads != null && suggestHeads > 0 ? (
                <span className="ml-1 text-sm font-semibold text-warning-foreground">
                  (~{formatNumber(suggestHeads, 0)} {aquacultureT('fish', lang)})
                </span>
              ) : null}
            </p>
            {row.partial_harvest_post_load_kg_per_decimal ? (
              <p className="text-xs text-warning-foreground/90">
                → ~{formatNumber(Number(row.partial_harvest_post_load_kg_per_decimal), 1)}{' '}
                {aquacultureT('kgDecimalAfter', lang)}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {row.partial_harvest_rationale ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{row.partial_harvest_rationale}</p>
      ) : row.advice_summary ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{row.advice_summary}</p>
      ) : null}
      {applicable ? (
        <p className="mt-2 text-[11px] text-warning-foreground/80">{aquacultureT('advisoryOnly', lang)}</p>
      ) : null}
    </div>
  )
}
