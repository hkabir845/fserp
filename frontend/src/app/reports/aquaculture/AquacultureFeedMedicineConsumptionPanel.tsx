'use client'

import type { ReactNode } from 'react'
import { Package, Pill } from 'lucide-react'
import { ReportAmountCell } from '@/components/reports/ReportAmountCell'
import { formatNumber } from '@/utils/currency'

function MoneyBdt(amount: unknown) {
  return <ReportAmountCell amount={Number(amount ?? 0)} currency="BDT" plain />
}

type ConsumptionLine = {
  id?: number
  entry_date?: string
  kind?: string
  kind_label?: string
  item_name?: string
  quantity?: string | number | null
  unit?: string
  feed_weight_kg?: string | number | null
  amount?: string | number
  source_doc?: string
  memo?: string
}

type ConsumptionGroup = {
  pond_id: number
  pond_name: string
  lines?: ConsumptionLine[]
  subtotal_feed_amount?: string
  subtotal_medicine_amount?: string
  subtotal_amount?: string
  subtotal_feed_kg?: string
}

type PeriodFilterProps = {
  period: { start_date?: string; end_date?: string }
  dateRange?: { startDate: string; endDate: string }
  reportType: string
  hint: string
}

export type AquacultureFeedMedicineConsumptionPanelProps = {
  data: Record<string, unknown>
  hasPeriod: boolean
  renderPeriodFilter: (props: PeriodFilterProps) => ReactNode
  reportType?: string
  dateRange?: { startDate: string; endDate: string }
  pondScopeLabel?: string | null
}

function pondTotalLabel(pondName?: string | null) {
  return pondName ? `Total — ${pondName}` : 'Grand total — all ponds'
}

function FcrSummaryBlock({ data }: { data: Record<string, unknown> }) {
  const fcr = data.fcr as Record<string, unknown> | undefined
  if (!fcr) return null
  const scoped = (fcr.scoped ?? fcr.portfolio) as Record<string, unknown> | undefined
  if (!scoped) return null
  const feed = Number(scoped.feed_kg ?? 0)
  const gain = Number(scoped.biomass_gain_kg ?? 0)
  const harvest = Number(scoped.harvest_kg ?? 0)
  const fcrBio = scoped.fcr_biomass != null ? Number(scoped.fcr_biomass) : null
  const fcrHar = scoped.fcr_harvest != null ? Number(scoped.fcr_harvest) : null
  if (feed <= 0 && gain <= 0 && harvest <= 0) return null
  return (
    <div className="rounded-lg border border-primary/25 bg-accent/50 px-4 py-3">
      <h4 className="text-sm font-semibold text-teal-950">Feed conversion (FCR) — period</h4>
      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
        <div>
          <span className="text-xs text-primary/80">Feed recorded</span>
          <p className="font-semibold tabular-nums text-teal-950">
            {feed > 0 ? `${formatNumber(feed, 2)} kg` : '—'}
          </p>
        </div>
        <div>
          <span className="text-xs text-primary/80">Biomass gain (sampling)</span>
          <p className="font-semibold tabular-nums text-teal-950">
            {gain > 0 ? `${formatNumber(gain, 2)} kg` : '—'}
          </p>
        </div>
        <div>
          <span className="text-xs text-primary/80">FCR (feed ÷ biomass gain)</span>
          <p className="font-semibold tabular-nums text-teal-950">
            {fcrBio != null && Number.isFinite(fcrBio) ? formatNumber(fcrBio, 2) : '—'}
          </p>
        </div>
        <div>
          <span className="text-xs text-primary/80">FCR (feed ÷ harvest kg)</span>
          <p className="font-semibold tabular-nums text-teal-950">
            {fcrHar != null && Number.isFinite(fcrHar) ? formatNumber(fcrHar, 2) : '—'}
          </p>
        </div>
      </div>
      {typeof fcr.methodology === 'string' ? (
        <p className="mt-2 text-[11px] leading-relaxed text-primary/70">{fcr.methodology}</p>
      ) : null}
    </div>
  )
}

export function AquacultureFeedMedicineConsumptionPanel({
  data,
  hasPeriod,
  renderPeriodFilter,
  reportType = 'aquaculture-feed-medicine-consumption',
  dateRange,
  pondScopeLabel,
}: AquacultureFeedMedicineConsumptionPanelProps) {
  const period = (data.period as { start_date?: string; end_date?: string }) || {}
  const groups = (Array.isArray(data.groups) ? data.groups : []) as ConsumptionGroup[]
  const totals = (data.totals as Record<string, unknown>) || {}
  const summary = (data.summary as Record<string, unknown>) || {}

  const totalFeed = Number(totals.total_feed_amount ?? summary.total_feed_amount_bdt ?? 0)
  const totalMed = Number(totals.total_medicine_amount ?? summary.total_medicine_amount_bdt ?? 0)
  const totalAmount = Number(totals.total_amount ?? summary.total_amount_bdt ?? 0)
  const totalFeedKg = Number(totals.total_feed_kg ?? summary.total_feed_kg ?? 0)
  const lineCount = Number(summary.line_count ?? totals.line_count ?? 0)
  const pondCount = Number(summary.pond_group_count ?? groups.length)

  return (
    <div className="space-y-8">
      {hasPeriod &&
        renderPeriodFilter({
          period,
          dateRange,
          reportType,
          hint: 'Consumption date within this range. Use Pond filter for one pond or leave empty for all ponds.',
        })}

      <div>
        <p className="text-sm font-medium text-foreground/85">
          Feed and medicine consumed from pond warehouses — costs in <strong>BDT</strong> at inventory value when
          used.
          {pondScopeLabel ? (
            <>
              {' '}
              Scoped to pond: <strong>{pondScopeLabel}</strong>.
            </>
          ) : null}
        </p>
        {typeof data.accounting_note === 'string' ? (
          <p className="mt-2 text-xs text-muted-foreground">{data.accounting_note}</p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-900">
            <Package className="h-4 w-4" aria-hidden />
            Feed cost
          </div>
          <p className="mt-2 text-xl font-bold tabular-nums text-amber-950">{MoneyBdt(totalFeed)}</p>
          {totalFeedKg > 0 ? (
            <p className="mt-1 text-xs text-amber-800/80">{formatNumber(totalFeedKg, 2)} kg recorded</p>
          ) : null}
        </div>
        <div className="rounded-lg border border-violet-200 bg-violet-50/80 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-900">
            <Pill className="h-4 w-4" aria-hidden />
            Medicine cost
          </div>
          <p className="mt-2 text-xl font-bold tabular-nums text-violet-950">{MoneyBdt(totalMed)}</p>
        </div>
        <div className="rounded-lg border border-rose-200 bg-rose-50/80 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-900">Total consumption</p>
          <p className="mt-2 text-xl font-bold tabular-nums text-rose-950">{MoneyBdt(totalAmount)}</p>
        </div>
        <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ponds</p>
          <p className="mt-2 text-xl font-bold tabular-nums text-foreground">{pondCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Consumption lines</p>
          <p className="mt-2 text-xl font-bold tabular-nums text-foreground">{lineCount}</p>
        </div>
        {totalFeedKg > 0 ? (
          <div className="rounded-lg border border-cyan-200 bg-cyan-50/80 p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-900">Feed weight</p>
            <p className="mt-2 text-xl font-bold tabular-nums text-cyan-950">
              {formatNumber(totalFeedKg, 2)} kg
            </p>
          </div>
        ) : null}
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">No feed or medicine consumption in this period.</p>
      ) : (
        groups.map((g) => (
          <div
            key={`fmc-${g.pond_id}`}
            className="rounded-lg border border-border bg-white shadow-sm"
          >
            <div className="border-b border-border/70 bg-cyan-50/80 px-4 py-2">
              <h4 className="font-semibold text-cyan-950">{g.pond_name}</h4>
              <p className="text-xs text-cyan-900/70">
                Feed {MoneyBdt(g.subtotal_feed_amount)} · Medicine {MoneyBdt(g.subtotal_medicine_amount)}
                {g.subtotal_feed_kg && Number(g.subtotal_feed_kg) > 0
                  ? ` · ${formatNumber(Number(g.subtotal_feed_kg), 2)} kg feed`
                  : ''}
              </p>
            </div>
            <div className="overflow-x-auto p-2">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-2 py-1">Date</th>
                    <th className="px-2 py-1">Type</th>
                    <th className="px-2 py-1">Item</th>
                    <th className="px-2 py-1 text-right">Qty</th>
                    <th className="px-2 py-1 text-right">Feed (kg)</th>
                    <th className="px-2 py-1 text-right">Cost (BDT)</th>
                    <th className="px-2 py-1">Source / memo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/70">
                  {(g.lines || []).map((ln) => (
                    <tr key={ln.id ?? `${g.pond_id}-${ln.entry_date}-${ln.kind}`}>
                      <td className="px-2 py-1.5 whitespace-nowrap">{ln.entry_date}</td>
                      <td className="px-2 py-1.5">{ln.kind_label || ln.kind}</td>
                      <td className="px-2 py-1.5">{ln.item_name || '—'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {ln.quantity != null ? `${ln.quantity}${ln.unit ? ` ${ln.unit}` : ''}` : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {ln.feed_weight_kg ? formatNumber(Number(ln.feed_weight_kg), 2) : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{MoneyBdt(ln.amount)}</td>
                      <td className="px-2 py-1.5 text-muted-foreground">
                        {ln.source_doc || ln.memo || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-muted/40">
                  <tr>
                    <td colSpan={5} className="px-2 py-2 text-right text-xs font-semibold text-foreground">
                      Sub-total — {g.pond_name}
                    </td>
                    <td className="px-2 py-2 text-right text-xs font-bold tabular-nums text-foreground">
                      {MoneyBdt(g.subtotal_amount)}
                    </td>
                    <td className="px-2 py-2 text-right text-xs text-muted-foreground">
                      Feed {MoneyBdt(g.subtotal_feed_amount)} · Medicine {MoneyBdt(g.subtotal_medicine_amount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ))
      )}

      <div className="rounded-lg border-2 border-border bg-muted/40 px-4 py-3 space-y-2">
        <div className="flex flex-wrap justify-between gap-2 text-sm font-bold text-foreground">
          <span>{pondTotalLabel(groups.length === 1 ? groups[0]?.pond_name : pondScopeLabel)}</span>
          <span className="tabular-nums">{MoneyBdt(totals.total_amount ?? totalAmount)}</span>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          <span>Feed: {MoneyBdt(totals.total_feed_amount ?? totalFeed)}</span>
          <span>Medicine: {MoneyBdt(totals.total_medicine_amount ?? totalMed)}</span>
          {totalFeedKg > 0 ? <span>Feed weight: {formatNumber(totalFeedKg, 2)} kg</span> : null}
          <span>{lineCount} consumption line(s)</span>
        </div>
      </div>

      <FcrSummaryBlock data={data} />
    </div>
  )
}
