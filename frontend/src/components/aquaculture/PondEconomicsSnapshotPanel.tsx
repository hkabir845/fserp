'use client'

import Link from 'next/link'
import { ArrowRight, Fish, Gauge, Scale, TrendingUp, Wallet } from 'lucide-react'
import { formatNumber, getCurrencySymbol } from '@/utils/currency'
import { formatDateOnly } from '@/utils/date'

export type PondEconomicsSnapshot = {
  pond_id: number
  pond_name: string
  pond_role?: string
  pond_role_label?: string
  as_of_date: string
  live_fish_count: number
  stocked_fish_count?: number | null
  book_weight_kg?: string | null
  biomass_kg?: string | null
  current_fish_per_kg?: string | null
  current_avg_weight_kg?: string | null
  current_fish_per_kg_source?: string | null
  water_area_decimal?: string | null
  stock_density_kg_per_decimal?: string | null
  load_level_label?: string | null
  latest_sample_date?: string | null
  total_biological_asset_value?: string | null
  cost_per_fish?: string | null
  cost_per_kg?: string | null
  gl_1581_balance?: string | null
  gl_reconciliation_note?: string | null
  transfer_cost_per_head?: string | null
  transfer_cost_basis_note?: string | null
  last_sale_price_per_kg?: string | null
  implied_market_value?: string | null
  book_value_at_cost?: string | null
  last_sale?: {
    sale_date?: string
    price_per_kg?: string
    buyer_name?: string
    fish_species_label?: string
  } | null
}

function parseNum(s: string | null | undefined): number {
  if (s == null || s === '') return 0
  const n = Number(String(s).replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

function fmtMoney(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—'
  return formatNumber(n, digits)
}

type Props = {
  snapshot: PondEconomicsSnapshot | null
  currency: string
  loading?: boolean
  pondId: number
  compact?: boolean
}

export function PondEconomicsSnapshotPanel({
  snapshot,
  currency,
  loading,
  pondId,
  compact = false,
}: Props) {
  const sym = getCurrencySymbol(currency)

  if (loading) {
    return (
      <section className="mb-6 rounded-2xl border border-primary/25/80 bg-gradient-to-br from-teal-50/80 to-card p-6 shadow-sm">
        <div className="flex justify-center py-8">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
        </div>
      </section>
    )
  }

  if (!snapshot) return null

  const live = snapshot.live_fish_count ?? 0
  const biomass = parseNum(snapshot.biomass_kg ?? snapshot.book_weight_kg)
  const bioCost = parseNum(snapshot.total_biological_asset_value)
  const costPerFish = parseNum(snapshot.cost_per_fish)
  const costPerKg = parseNum(snapshot.cost_per_kg)
  const pcsKg = parseNum(snapshot.current_fish_per_kg)
  const density = parseNum(snapshot.stock_density_kg_per_decimal)
  const transferPerHead = parseNum(snapshot.transfer_cost_per_head)
  const lastPriceKg = parseNum(snapshot.last_sale_price_per_kg)
  const marketVal = parseNum(snapshot.implied_market_value)
  const isNursing = (snapshot.pond_role || '').toLowerCase() === 'nursing'

  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-primary/25/80 bg-gradient-to-br from-teal-50/60 via-white to-slate-50/40 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-teal-100/80 px-5 py-4">
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-primary">
            <Fish className="h-4 w-4" aria-hidden />
            Pond economics snapshot
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {snapshot.pond_role_label || snapshot.pond_role || 'Pond'}
            {' · '}
            As of {formatDateOnly(snapshot.as_of_date)}
            {snapshot.latest_sample_date ? (
              <>
                {' '}
                · Last sample {formatDateOnly(snapshot.latest_sample_date)}
              </>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <Link
            href={`/aquaculture/transfers?from_pond_id=${pondId}`}
            className="rounded-lg border border-primary/25 bg-white px-2.5 py-1 font-medium text-primary hover:bg-accent"
          >
            Transfer fish
          </Link>
          <Link
            href={`/aquaculture/feeding?pond_id=${pondId}`}
            className="rounded-lg border border-border bg-white px-2.5 py-1 font-medium text-foreground/85 hover:bg-muted/40"
          >
            Feeding advice
          </Link>
          <Link
            href="/aquaculture/sampling"
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-white px-2.5 py-1 font-medium text-foreground/85 hover:bg-muted/40"
          >
            Sampling
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      <div className={`grid gap-3 p-5 ${compact ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-2 lg:grid-cols-4'}`}>
        <Metric
          icon={Fish}
          label="Live fish"
          value={live > 0 ? formatNumber(live, 0) : '—'}
          sub={
            snapshot.stocked_fish_count != null && snapshot.stocked_fish_count > live
              ? `Stocked ${formatNumber(snapshot.stocked_fish_count, 0)} · survivors carry full cost`
              : pcsKg > 0
                ? `${fmtMoney(pcsKg, 1)} pcs/kg${snapshot.current_fish_per_kg_source ? ` (${snapshot.current_fish_per_kg_source})` : ''}`
                : undefined
          }
        />
        <Metric
          icon={Scale}
          label="Biomass"
          value={biomass > 0 ? `${fmtMoney(biomass, 2)} kg` : '—'}
          sub={
            snapshot.current_avg_weight_kg
              ? `Avg ${fmtMoney(parseNum(snapshot.current_avg_weight_kg), 4)} kg/fish`
              : undefined
          }
        />
        <Metric
          icon={Gauge}
          label="Density"
          value={density > 0 ? `${fmtMoney(density, 1)} kg/dec` : '—'}
          sub={snapshot.load_level_label || undefined}
        />
        <Metric
          icon={Wallet}
          label="Production cost (book)"
          value={bioCost > 0 ? `${sym}${fmtMoney(bioCost, 0)}` : '—'}
          sub={
            costPerFish > 0
              ? `${sym}${fmtMoney(costPerFish, 2)}/fish · ${sym}${fmtMoney(costPerKg, 2)}/kg`
              : undefined
          }
        />
        {!compact && lastPriceKg > 0 ? (
          <Metric
            icon={TrendingUp}
            label="Market value (last sale)"
            value={marketVal > 0 ? `${sym}${fmtMoney(marketVal, 0)}` : '—'}
            sub={
              snapshot.last_sale?.sale_date
                ? `${sym}${fmtMoney(lastPriceKg, 2)}/kg · sale ${formatDateOnly(snapshot.last_sale.sale_date)}`
                : `${sym}${fmtMoney(lastPriceKg, 2)}/kg`
            }
          />
        ) : null}
        {!compact && isNursing && transferPerHead > 0 ? (
          <Metric
            icon={ArrowRight}
            label="Transfer cost / head"
            value={`${sym}${fmtMoney(transferPerHead, 2)}`}
            sub="Fry + expenses ÷ live fingerlings"
          />
        ) : null}
      </div>

      {snapshot.gl_reconciliation_note ? (
        <p className="border-t border-teal-100/60 px-5 py-2 text-[11px] leading-snug text-muted-foreground">
          {snapshot.gl_reconciliation_note}
        </p>
      ) : null}
      {snapshot.transfer_cost_basis_note && isNursing ? (
        <p className="border-t border-teal-100/60 px-5 py-2 text-[11px] leading-snug text-muted-foreground">
          {snapshot.transfer_cost_basis_note}
        </p>
      ) : null}
    </section>
  )
}

function Metric({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Fish
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-xl border border-white/80 bg-white/90 p-3 shadow-sm ring-1 ring-slate-100/80">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </p>
      <p className="mt-1.5 text-lg font-semibold tabular-nums text-foreground">{value}</p>
      {sub ? <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{sub}</p> : null}
    </div>
  )
}
