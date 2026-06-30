'use client'

import { formatNumber } from '@/utils/currency'
import type { FcrBlock } from './aquacultureFishMetrics'

type Props = {
  fcr: FcrBlock | null | undefined
  title?: string
  className?: string
}

/** FCR summary block for aquaculture reports and pond dashboards. */
export function AquacultureFcrSummaryPanel({ fcr, title = 'Feed conversion (FCR)', className = '' }: Props) {
  if (!fcr) return null
  const p = fcr.scoped ?? fcr.portfolio
  if (!p) return null

  const feed = Number(p.feed_kg ?? 0)
  const gain = Number(p.biomass_gain_kg ?? 0)
  const harvest = Number(p.harvest_kg ?? 0)
  const fcrBio = p.fcr_biomass != null ? Number(p.fcr_biomass) : null
  const fcrHar = p.fcr_harvest != null ? Number(p.fcr_harvest) : null

  if (feed <= 0 && gain <= 0 && harvest <= 0) return null

  return (
    <section className={`rounded-xl border border-border bg-muted/50 p-4 ${className}`}>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {fcr.period_start && fcr.period_end ? (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {fcr.period_start} → {fcr.period_end}
        </p>
      ) : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-white bg-white px-3 py-2 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Feed recorded</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
            {feed > 0 ? `${formatNumber(feed, 2)} kg` : '—'}
          </p>
        </div>
        <div className="rounded-lg border border-white bg-white px-3 py-2 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Biomass gain (sampling)</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
            {gain > 0 ? `${formatNumber(gain, 2)} kg` : '—'}
          </p>
          {p.biomass_gain_note ? <p className="mt-0.5 text-[10px] text-muted-foreground">{p.biomass_gain_note}</p> : null}
        </div>
        <div className="rounded-lg border border-white bg-white px-3 py-2 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">FCR (feed ÷ biomass gain)</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-primary">
            {fcrBio != null && Number.isFinite(fcrBio) ? formatNumber(fcrBio, 2) : '—'}
          </p>
        </div>
        <div className="rounded-lg border border-white bg-white px-3 py-2 shadow-sm">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">FCR (feed ÷ harvest kg)</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">
            {fcrHar != null && Number.isFinite(fcrHar) ? formatNumber(fcrHar, 2) : '—'}
          </p>
          {harvest > 0 ? (
            <p className="mt-0.5 text-[10px] text-muted-foreground">{formatNumber(harvest, 2)} kg harvested</p>
          ) : null}
        </div>
      </div>
      {fcr.methodology ? (
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{fcr.methodology}</p>
      ) : null}
    </section>
  )
}
