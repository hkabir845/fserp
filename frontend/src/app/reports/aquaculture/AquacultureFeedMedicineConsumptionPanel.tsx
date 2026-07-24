'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Package, Pill } from 'lucide-react'
import { ReportAmountCell } from '@/components/reports/ReportAmountCell'
import { formatNumber } from '@/utils/currency'

function MoneyBdt(amount: unknown) {
  return <ReportAmountCell amount={Number(amount ?? 0)} currency="BDT" plain />
}

function Qty({ value, digits = 2 }: { value: unknown; digits?: number }) {
  const n = Number(value ?? 0)
  if (!Number.isFinite(n) || n === 0) return <span className="text-muted-foreground">—</span>
  return <span className="tabular-nums">{formatNumber(n, digits)}</span>
}

type DailyFeedRow = {
  date?: string
  sacks?: string | number
  kg?: string | number
  tons?: string | number
  amount?: string | number
  entry_count?: number
  pond_count?: number
}

type DailyMedicineRow = {
  date?: string
  amount?: string | number
  entry_count?: number
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
  feed_sack_count?: string | number | null
  amount?: string | number
  source_doc?: string
  memo?: string
}

type ConsumptionGroup = {
  pond_id: number
  pond_name: string
  daily_feed?: DailyFeedRow[]
  daily_medicine?: DailyMedicineRow[]
  feed_lines?: ConsumptionLine[]
  medicine_lines?: ConsumptionLine[]
  lines?: ConsumptionLine[]
  subtotal_feed_amount?: string
  subtotal_medicine_amount?: string
  subtotal_amount?: string
  subtotal_feed_kg?: string
  subtotal_feed_sacks?: string
  subtotal_feed_tons?: string
  feed_day_count?: number
  medicine_day_count?: number
  feed_line_count?: number
  medicine_line_count?: number
}

type PeriodFilterProps = {
  period: { start_date?: string; end_date?: string }
  dateRange?: { startDate: string; endDate: string }
  reportType: string
  hint: string
}

export type ConsumptionReportMode = 'feed' | 'medicine' | 'both'

export type AquacultureFeedMedicineConsumptionPanelProps = {
  data: Record<string, unknown>
  hasPeriod: boolean
  renderPeriodFilter: (props: PeriodFilterProps) => ReactNode
  reportType?: string
  mode?: ConsumptionReportMode
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

function DailyFeedTable({
  rows,
  footerLabel,
  footerSacks,
  footerKg,
  footerTons,
  footerAmount,
  showPondCount,
}: {
  rows: DailyFeedRow[]
  footerLabel: string
  footerSacks?: string | number
  footerKg?: string | number
  footerTons?: string | number
  footerAmount?: string | number
  showPondCount?: boolean
}) {
  if (!rows.length) {
    return <p className="px-3 py-2 text-sm text-muted-foreground">No daily feed consumption in this period.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-2 py-1.5">Date</th>
            {showPondCount ? <th className="px-2 py-1.5 text-right">Ponds</th> : null}
            <th className="px-2 py-1.5 text-right">Sacks</th>
            <th className="px-2 py-1.5 text-right">kg</th>
            <th className="px-2 py-1.5 text-right">Tons (t)</th>
            <th className="px-2 py-1.5 text-right">Cost (BDT)</th>
            <th className="px-2 py-1.5 text-right">Entries</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {rows.map((row) => (
            <tr key={row.date}>
              <td className="px-2 py-1.5 whitespace-nowrap font-medium">{row.date}</td>
              {showPondCount ? (
                <td className="px-2 py-1.5 text-right tabular-nums">{row.pond_count ?? '—'}</td>
              ) : null}
              <td className="px-2 py-1.5 text-right">
                <Qty value={row.sacks} />
              </td>
              <td className="px-2 py-1.5 text-right">
                <Qty value={row.kg} />
              </td>
              <td className="px-2 py-1.5 text-right">
                <Qty value={row.tons} digits={4} />
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{MoneyBdt(row.amount)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                {row.entry_count ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-muted/50">
          <tr>
            <td className="px-2 py-2 text-xs font-semibold" colSpan={showPondCount ? 2 : 1}>
              {footerLabel}
            </td>
            <td className="px-2 py-2 text-right text-xs font-bold">
              <Qty value={footerSacks} />
            </td>
            <td className="px-2 py-2 text-right text-xs font-bold">
              <Qty value={footerKg} />
            </td>
            <td className="px-2 py-2 text-right text-xs font-bold">
              <Qty value={footerTons} digits={4} />
            </td>
            <td className="px-2 py-2 text-right text-xs font-bold tabular-nums">{MoneyBdt(footerAmount)}</td>
            <td className="px-2 py-2" />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function EntryDetailTable({ lines }: { lines: ConsumptionLine[] }) {
  if (!lines.length) return null
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="px-2 py-1">Date</th>
            <th className="px-2 py-1">Type</th>
            <th className="px-2 py-1">Item</th>
            <th className="px-2 py-1 text-right">Qty</th>
            <th className="px-2 py-1 text-right">Sacks</th>
            <th className="px-2 py-1 text-right">kg</th>
            <th className="px-2 py-1 text-right">Tons</th>
            <th className="px-2 py-1 text-right">Cost (BDT)</th>
            <th className="px-2 py-1">Source / memo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {lines.map((ln) => {
            const kg = Number(ln.feed_weight_kg ?? 0)
            const tons = kg > 0 ? kg / 1000 : 0
            return (
              <tr key={ln.id ?? `${ln.entry_date}-${ln.kind}-${ln.item_name}`}>
                <td className="px-2 py-1.5 whitespace-nowrap">{ln.entry_date}</td>
                <td className="px-2 py-1.5">{ln.kind_label || ln.kind}</td>
                <td className="px-2 py-1.5">{ln.item_name || '—'}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {ln.quantity != null ? `${ln.quantity}${ln.unit ? ` ${ln.unit}` : ''}` : '—'}
                </td>
                <td className="px-2 py-1.5 text-right">
                  <Qty value={ln.feed_sack_count} />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <Qty value={ln.feed_weight_kg} />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <Qty value={tons || null} digits={4} />
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">{MoneyBdt(ln.amount)}</td>
                <td className="px-2 py-1.5 text-muted-foreground">{ln.source_doc || ln.memo || '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function PondSection({ group, mode }: { group: ConsumptionGroup; mode: ConsumptionReportMode }) {
  const [showDetail, setShowDetail] = useState(false)
  const showFeed = mode === 'feed' || mode === 'both'
  const showMed = mode === 'medicine' || mode === 'both'
  const dailyFeed = group.daily_feed || []
  const dailyMed = group.daily_medicine || []
  const detailLines = (group.lines || []).filter((l) => {
    if (mode === 'feed') return l.kind === 'feed'
    if (mode === 'medicine') return l.kind === 'medicine'
    return true
  })
  const medLines = group.medicine_lines || detailLines.filter((l) => l.kind === 'medicine')

  return (
    <div className="rounded-lg border border-border bg-white shadow-sm">
      <div className="border-b border-border/70 bg-cyan-50/80 px-4 py-3">
        <h4 className="font-semibold text-cyan-950">{group.pond_name}</h4>
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-cyan-900/80">
          {showFeed ? (
            <>
              <span>
                Feed: <Qty value={group.subtotal_feed_sacks} /> sacks · <Qty value={group.subtotal_feed_kg} /> kg ·{' '}
                <Qty value={group.subtotal_feed_tons} digits={4} /> t
              </span>
              <span>Feed cost: {MoneyBdt(group.subtotal_feed_amount)}</span>
              <span>{group.feed_day_count ?? dailyFeed.length} feed day(s)</span>
            </>
          ) : null}
          {showMed ? (
            <>
              <span>Medicine: {MoneyBdt(group.subtotal_medicine_amount)}</span>
              <span>{group.medicine_day_count ?? dailyMed.length} medicine day(s)</span>
            </>
          ) : null}
        </p>
      </div>

      <div className="space-y-4 p-3">
        {showFeed ? (
          <div>
            <h5 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-amber-900">
              Daily feed consumption
            </h5>
            <DailyFeedTable
              rows={dailyFeed}
              footerLabel={`Total — ${group.pond_name}`}
              footerSacks={group.subtotal_feed_sacks}
              footerKg={group.subtotal_feed_kg}
              footerTons={group.subtotal_feed_tons}
              footerAmount={group.subtotal_feed_amount}
            />
          </div>
        ) : null}

        {showMed && (dailyMed.length > 0 || medLines.length > 0) ? (
          <div>
            <h5 className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-violet-900">
              Medicine consumption
            </h5>
            {dailyMed.length > 0 ? (
              <div className="mb-2 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="px-2 py-1.5">Date</th>
                      <th className="px-2 py-1.5 text-right">Cost (BDT)</th>
                      <th className="px-2 py-1.5 text-right">Entries</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {dailyMed.map((row) => (
                      <tr key={`med-${row.date}`}>
                        <td className="px-2 py-1.5 whitespace-nowrap font-medium">{row.date}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{MoneyBdt(row.amount)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                          {row.entry_count ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-violet-50/60">
                    <tr>
                      <td className="px-2 py-2 text-xs font-semibold">Medicine total — {group.pond_name}</td>
                      <td className="px-2 py-2 text-right text-xs font-bold tabular-nums">
                        {MoneyBdt(group.subtotal_medicine_amount)}
                      </td>
                      <td className="px-2 py-2" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : null}
            {medLines.length > 0 ? (
              <div className="rounded border border-violet-100 bg-violet-50/30 p-2">
                <p className="mb-1 text-[11px] font-medium text-violet-900/80">Medicine entries</p>
                <EntryDetailTable lines={medLines} />
              </div>
            ) : null}
          </div>
        ) : null}

        <div>
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {showDetail ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            {showDetail ? 'Hide' : 'Show'} entry detail ({detailLines.length} line
            {detailLines.length === 1 ? '' : 's'})
          </button>
          {showDetail ? (
            <div className="mt-2 rounded border border-border/70 bg-muted/20 p-2">
              <EntryDetailTable lines={detailLines} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function AquacultureFeedMedicineConsumptionPanel({
  data,
  hasPeriod,
  renderPeriodFilter,
  reportType = 'aquaculture-feed-consumption',
  mode = 'both',
  dateRange,
  pondScopeLabel,
}: AquacultureFeedMedicineConsumptionPanelProps) {
  const period = (data.period as { start_date?: string; end_date?: string }) || {}
  const groups = (Array.isArray(data.groups) ? data.groups : []) as ConsumptionGroup[]
  const farmDaily = (Array.isArray(data.farm_daily_feed) ? data.farm_daily_feed : []) as DailyFeedRow[]
  const totals = (data.totals as Record<string, unknown>) || {}
  const summary = (data.summary as Record<string, unknown>) || {}
  const showFeed = mode === 'feed' || mode === 'both'
  const showMed = mode === 'medicine' || mode === 'both'

  const totalFeed = Number(totals.total_feed_amount ?? summary.total_feed_amount_bdt ?? 0)
  const totalMed = Number(totals.total_medicine_amount ?? summary.total_medicine_amount_bdt ?? 0)
  const totalAmount = Number(totals.total_amount ?? summary.total_amount_bdt ?? 0)
  const totalFeedKg = Number(totals.total_feed_kg ?? summary.total_feed_kg ?? 0)
  const totalFeedSacks = Number(totals.total_feed_sacks ?? summary.total_feed_sacks ?? 0)
  const totalFeedTons = Number(totals.total_feed_tons ?? summary.total_feed_tons ?? 0)
  const lineCount = Number(summary.line_count ?? totals.line_count ?? 0)
  const pondCount = Number(summary.pond_group_count ?? groups.length)
  const feedDayCount = Number(totals.feed_day_count ?? summary.feed_day_count ?? farmDaily.length)
  const medDayCount = Number(
    summary.medicine_day_count ??
      groups.reduce((n, g) => n + Number(g.medicine_day_count ?? g.daily_medicine?.length ?? 0), 0)
  )
  const showFarmDaily = showFeed && !pondScopeLabel && groups.length > 1 && farmDaily.length > 0
  const periodHint =
    mode === 'medicine'
      ? 'Medicine consumed from pond warehouses by day and entry. Optional pond and medicine filters narrow the ledger.'
      : mode === 'feed'
        ? 'Daily feed by pond in sacks, kg, and metric tons (1 t = 1,000 kg). Optional pond and feed filters narrow the ledger.'
        : 'Daily feed by pond in sacks, kg, and metric tons (1 t = 1,000 kg). Optional pond, feed, and medicine filters narrow the ledger.'
  const intro =
    mode === 'medicine'
      ? 'Pond medicine consumption — daily totals and entry detail at inventory cost (BDT).'
      : mode === 'feed'
        ? 'Pond feed consumption — daily ledger with sacks, kg, tons, and cost (BDT at inventory value).'
        : 'Standard pond feed & medicine consumption — daily feed ledger with sacks, kg, tons, and cost (BDT at inventory value).'
  const emptyLabel =
    mode === 'medicine'
      ? 'No medicine consumption in this period.'
      : mode === 'feed'
        ? 'No feed consumption in this period.'
        : 'No feed or medicine consumption in this period.'
  const sectionTitle =
    mode === 'medicine' ? 'Per-pond medicine consumption' : mode === 'feed' ? 'Per-pond daily feed' : 'Per-pond consumption'

  return (
    <div className="space-y-8">
      {hasPeriod &&
        renderPeriodFilter({
          period,
          dateRange,
          reportType,
          hint: periodHint,
        })}

      <div>
        <p className="text-sm font-medium text-foreground/85">
          {intro}
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

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(11.5rem,1fr))]">
        {showFeed ? (
          <>
            <div className="min-w-0 overflow-hidden rounded-lg border border-amber-200 bg-amber-50/80 p-4 shadow-sm">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-amber-900">
                <Package className="h-4 w-4 shrink-0" aria-hidden />
                Feed cost
              </div>
              <p className="mt-2 break-words text-base font-bold leading-tight tracking-tight tabular-nums text-amber-950 sm:text-lg">
                {MoneyBdt(totalFeed)}
              </p>
            </div>
            <div className="min-w-0 overflow-hidden rounded-lg border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">Feed sacks</p>
              <p className="mt-2 break-words text-base font-bold leading-tight tracking-tight tabular-nums text-amber-950 sm:text-lg">
                <Qty value={totalFeedSacks} />
              </p>
            </div>
            <div className="min-w-0 overflow-hidden rounded-lg border border-cyan-200 bg-cyan-50/80 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-cyan-900">Feed kg</p>
              <p className="mt-2 break-words text-base font-bold leading-tight tracking-tight tabular-nums text-cyan-950 sm:text-lg">
                <Qty value={totalFeedKg} />
              </p>
            </div>
            <div className="min-w-0 overflow-hidden rounded-lg border border-cyan-200 bg-cyan-50/50 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-cyan-900">Feed tons</p>
              <p className="mt-2 break-words text-base font-bold leading-tight tracking-tight tabular-nums text-cyan-950 sm:text-lg">
                <Qty value={totalFeedTons} digits={4} />
              </p>
              <p className="mt-1 text-[11px] text-cyan-800/70">1 t = 1,000 kg</p>
            </div>
          </>
        ) : null}
        {showMed ? (
          <div className="min-w-0 overflow-hidden rounded-lg border border-violet-200 bg-violet-50/80 p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-violet-900">
              <Pill className="h-4 w-4 shrink-0" aria-hidden />
              Medicine cost
            </div>
            <p className="mt-2 break-words text-base font-bold leading-tight tracking-tight tabular-nums text-violet-950 sm:text-lg">
              {MoneyBdt(totalMed)}
            </p>
          </div>
        ) : null}
        {mode === 'both' ? (
          <div className="min-w-0 overflow-hidden rounded-lg border border-rose-200 bg-rose-50/80 p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-rose-900">Total cost</p>
            <p className="mt-2 break-words text-base font-bold leading-tight tracking-tight tabular-nums text-rose-950 sm:text-lg">
              {MoneyBdt(totalAmount)}
            </p>
          </div>
        ) : null}
        <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ponds</p>
          <p className="mt-2 break-words text-base font-bold leading-tight tracking-tight tabular-nums text-foreground sm:text-lg">
            {pondCount}
          </p>
        </div>
        {showFeed ? (
          <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Feed days</p>
            <p className="mt-2 break-words text-base font-bold leading-tight tracking-tight tabular-nums text-foreground sm:text-lg">
              {feedDayCount}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">{lineCount} entries</p>
          </div>
        ) : null}
        {showMed && !showFeed ? (
          <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Medicine days</p>
            <p className="mt-2 break-words text-base font-bold leading-tight tracking-tight tabular-nums text-foreground sm:text-lg">
              {medDayCount}
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">{lineCount} entries</p>
          </div>
        ) : null}
      </div>

      {showFarmDaily ? (
        <div className="rounded-lg border border-border bg-white shadow-sm">
          <div className="border-b border-border/70 bg-slate-50 px-4 py-2">
            <h4 className="font-semibold text-foreground">Farm daily feed — all ponds</h4>
            <p className="text-xs text-muted-foreground">
              Combined feed used each day across every pond with consumption in the period.
            </p>
          </div>
          <div className="p-3">
            <DailyFeedTable
              rows={farmDaily}
              footerLabel="Grand total — all ponds"
              footerSacks={totalFeedSacks}
              footerKg={totalFeedKg}
              footerTons={totalFeedTons}
              footerAmount={totalFeed}
              showPondCount
            />
          </div>
        </div>
      ) : null}

      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="space-y-6">
          <h3 className="text-sm font-semibold text-foreground">{sectionTitle}</h3>
          {groups.map((g) => (
            <PondSection key={`fmc-${g.pond_id}`} group={g} mode={mode} />
          ))}
        </div>
      )}

      <div className="rounded-lg border-2 border-border bg-muted/40 px-4 py-3 space-y-2">
        <div className="flex flex-wrap justify-between gap-2 text-sm font-bold text-foreground">
          <span>{pondTotalLabel(groups.length === 1 ? groups[0]?.pond_name : pondScopeLabel)}</span>
          <span className="tabular-nums">
            {MoneyBdt(mode === 'feed' ? totalFeed : mode === 'medicine' ? totalMed : totalAmount)}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
          {showFeed ? (
            <span>
              Feed: <Qty value={totalFeedSacks} /> sacks · <Qty value={totalFeedKg} /> kg ·{' '}
              <Qty value={totalFeedTons} digits={4} /> t · {MoneyBdt(totalFeed)}
            </span>
          ) : null}
          {showMed ? <span>Medicine: {MoneyBdt(totalMed)}</span> : null}
          <span>{lineCount} consumption line(s)</span>
        </div>
      </div>

      {showFeed ? <FcrSummaryBlock data={data} /> : null}
    </div>
  )
}
