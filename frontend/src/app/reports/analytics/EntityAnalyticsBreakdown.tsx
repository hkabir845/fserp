'use client'

import { MapPin, Fish, TrendingUp, Percent, type LucideIcon } from 'lucide-react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import type { AquacultureAnalyticsSummary, EntityAnalyticsRow } from './analyticsEntityTypes'
import { resolveReportTotalLabel } from '../reportSiteScope'

const Y_AXIS_CURRENCY_W = 100
const M_BAR_X = { top: 12, right: 12, left: 8, bottom: 64 } as const
const CHART_STANDARD =
  'h-[min(30rem,58svh)] min-h-[280px] w-full sm:min-h-[300px] md:min-h-[360px] md:h-[min(34rem,60svh)]'

function AnalyticsKpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconClass,
}: {
  title: string
  value: string
  subtitle?: string
  icon: LucideIcon
  iconClass: string
}) {
  return (
    <div className="rounded-xl border border-slate-200/90 bg-gradient-to-br from-white to-slate-50/80 p-4 shadow-sm ring-1 ring-slate-200/40">
      <div className="flex gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
          <Icon className="h-5 w-5 text-white" strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">{title}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-neutral-900">{value}</p>
          {subtitle ? <p className="mt-1 text-xs leading-snug text-neutral-500">{subtitle}</p> : null}
        </div>
      </div>
    </div>
  )
}

function sumField(rows: EntityAnalyticsRow[], pick: (r: EntityAnalyticsRow) => number) {
  return rows.reduce((acc, r) => acc + pick(r), 0)
}

function StationListTable({
  rows,
  fmt,
  totalLabel,
}: {
  rows: EntityAnalyticsRow[]
  fmt: (n: number) => string
  totalLabel: string
}) {
  const totals = {
    document_sales: sumField(rows, (r) => r.document_sales),
    pl_income: sumField(rows, (r) => r.pl_income),
    pl_cogs: sumField(rows, (r) => r.pl_cogs),
    pl_expenses: sumField(rows, (r) => r.pl_expenses),
    gross_profit: sumField(rows, (r) => r.gross_profit),
    net_income: sumField(rows, (r) => r.net_income),
  }
  return (
    <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200">
      <h3 className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-900">
        Station list
      </h3>
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Station</th>
            <th className="px-3 py-3 text-right text-xs font-medium uppercase text-slate-500">Invoice sales</th>
            <th className="px-3 py-3 text-right text-xs font-medium uppercase text-slate-500">P&amp;L income</th>
            <th className="px-3 py-3 text-right text-xs font-medium uppercase text-slate-500">COGS</th>
            <th className="px-3 py-3 text-right text-xs font-medium uppercase text-slate-500">Expenses</th>
            <th className="px-3 py-3 text-right text-xs font-medium uppercase text-slate-500">Gross profit</th>
            <th className="px-3 py-3 text-right text-xs font-medium uppercase text-slate-500">Net income</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((r) => (
            <tr key={`st-${r.entity_id}`} className="hover:bg-slate-50/80">
              <td className="px-4 py-3 font-medium text-slate-900">{r.entity_name}</td>
              <td className="px-3 py-3 text-right tabular-nums">{fmt(r.document_sales)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{fmt(r.pl_income)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{fmt(r.pl_cogs)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{fmt(r.pl_expenses)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{fmt(r.gross_profit)}</td>
              <td className="px-3 py-3 text-right font-semibold tabular-nums">{fmt(r.net_income)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-slate-200 bg-slate-100 font-semibold">
          <tr>
            <td className="px-4 py-3 text-slate-900">{totalLabel}</td>
            <td className="px-3 py-3 text-right tabular-nums">{fmt(totals.document_sales)}</td>
            <td className="px-3 py-3 text-right tabular-nums">{fmt(totals.pl_income)}</td>
            <td className="px-3 py-3 text-right tabular-nums">{fmt(totals.pl_cogs)}</td>
            <td className="px-3 py-3 text-right tabular-nums">{fmt(totals.pl_expenses)}</td>
            <td className="px-3 py-3 text-right tabular-nums">{fmt(totals.gross_profit)}</td>
            <td className="px-3 py-3 text-right tabular-nums">{fmt(totals.net_income)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function PondListTable({
  rows,
  fmt,
  totalLabel,
}: {
  rows: EntityAnalyticsRow[]
  fmt: (n: number) => string
  totalLabel: string
}) {
  const totals = {
    document_sales: sumField(rows, (r) => r.document_sales),
    management_revenue: sumField(rows, (r) => r.management_revenue_bdt ?? 0),
    management_profit: sumField(rows, (r) => r.management_profit_bdt ?? 0),
    pl_income: sumField(rows, (r) => r.pl_income),
    pl_cogs: sumField(rows, (r) => r.pl_cogs),
    pl_expenses: sumField(rows, (r) => r.pl_expenses),
    gross_profit: sumField(rows, (r) => r.gross_profit),
    net_income: sumField(rows, (r) => r.net_income),
  }
  return (
    <div className="mt-6 overflow-x-auto rounded-lg border border-teal-200/80">
      <h3 className="border-b border-teal-100 bg-teal-50/80 px-4 py-3 text-sm font-semibold text-teal-950">
        Pond list
      </h3>
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-teal-50/50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase text-slate-500">Pond</th>
            <th className="px-3 py-3 text-right text-xs font-medium uppercase text-slate-500 whitespace-nowrap">
              Sales (register)
            </th>
            <th className="px-3 py-3 text-right text-xs font-medium uppercase text-slate-500 whitespace-nowrap">
              Mgmt revenue
            </th>
            <th className="px-3 py-3 text-right text-xs font-medium uppercase text-slate-500 whitespace-nowrap">
              Mgmt profit
            </th>
            <th className="px-3 py-3 text-right text-xs font-medium uppercase text-slate-500">P&amp;L income</th>
            <th className="px-3 py-3 text-right text-xs font-medium uppercase text-slate-500">COGS</th>
            <th className="px-3 py-3 text-right text-xs font-medium uppercase text-slate-500">Expenses</th>
            <th className="px-3 py-3 text-right text-xs font-medium uppercase text-slate-500">Gross profit</th>
            <th className="px-3 py-3 text-right text-xs font-medium uppercase text-slate-500 whitespace-nowrap">
              Net income (GL)
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {rows.map((r) => (
            <tr key={`pond-${r.entity_id}`} className="hover:bg-teal-50/30">
              <td className="px-4 py-3 font-medium text-slate-900">{r.entity_name}</td>
              <td className="px-3 py-3 text-right tabular-nums">{fmt(r.document_sales)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{fmt(r.management_revenue_bdt ?? 0)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{fmt(r.management_profit_bdt ?? 0)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{fmt(r.pl_income)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{fmt(r.pl_cogs)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{fmt(r.pl_expenses)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{fmt(r.gross_profit)}</td>
              <td className="px-3 py-3 text-right font-semibold tabular-nums">{fmt(r.net_income)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-teal-100 bg-teal-50/60 font-semibold">
          <tr>
            <td className="px-4 py-3 text-teal-950">{totalLabel}</td>
            <td className="px-3 py-3 text-right tabular-nums">{fmt(totals.document_sales)}</td>
            <td className="px-3 py-3 text-right tabular-nums">{fmt(totals.management_revenue)}</td>
            <td className="px-3 py-3 text-right tabular-nums">{fmt(totals.management_profit)}</td>
            <td className="px-3 py-3 text-right tabular-nums">{fmt(totals.pl_income)}</td>
            <td className="px-3 py-3 text-right tabular-nums">{fmt(totals.pl_cogs)}</td>
            <td className="px-3 py-3 text-right tabular-nums">{fmt(totals.pl_expenses)}</td>
            <td className="px-3 py-3 text-right tabular-nums">{fmt(totals.gross_profit)}</td>
            <td className="px-3 py-3 text-right tabular-nums">{fmt(totals.net_income)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

type Props = {
  byStation: EntityAnalyticsRow[]
  byPond: EntityAnalyticsRow[]
  aquacultureSummary: AquacultureAnalyticsSummary | null
  daysSelected: number
  fmt: (n: number) => string
  reportStationKey?: string
  stations?: { id: number; station_name: string }[]
  ponds?: { id: number; name: string }[]
}

export function EntityAnalyticsBreakdown({
  byStation,
  byPond,
  aquacultureSummary,
  daysSelected,
  fmt,
  reportStationKey = '',
  stations = [],
  ponds = [],
}: Props) {
  if (byStation.length === 0 && byPond.length === 0) return null

  const stationTotalLabel = resolveReportTotalLabel(
    'station',
    reportStationKey,
    stations,
    ponds,
    { singleName: byStation.length === 1 ? byStation[0].entity_name : null }
  )
  const pondTotalLabel = resolveReportTotalLabel('pond', reportStationKey, stations, ponds, {
    singleName: byPond.length === 1 ? byPond[0].entity_name : null,
  })

  const stationNetIncomeBars = byStation.map((r) => ({
    name: r.entity_name,
    net_income: r.net_income,
    document_sales: r.document_sales,
  }))

  const pondPerformanceBars = byPond.map((r) => ({
    name: r.entity_name,
    net_income_gl: r.net_income,
    pond_sales: r.document_sales,
    management_revenue: r.management_revenue_bdt ?? 0,
    management_profit: r.management_profit_bdt ?? 0,
  }))

  return (
    <div className="mb-8 space-y-8">
      {aquacultureSummary && aquacultureSummary.active_ponds > 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <AnalyticsKpiCard
            title="Active ponds"
            value={String(aquacultureSummary.active_ponds)}
            subtitle="Included in pond comparison below"
            icon={Fish}
            iconClass="bg-teal-600"
          />
          <AnalyticsKpiCard
            title="Pond sales (register)"
            value={fmt(aquacultureSummary.total_pond_sales_bdt)}
            subtitle={`${daysSelected}d · fish/sack lines (BDT)`}
            icon={Fish}
            iconClass="bg-cyan-600"
          />
          <AnalyticsKpiCard
            title="Pond revenue (mgmt)"
            value={fmt(aquacultureSummary.total_management_revenue_bdt)}
            subtitle="Aquaculture P&L register totals"
            icon={TrendingUp}
            iconClass="bg-emerald-600"
          />
          <AnalyticsKpiCard
            title="Pond profit (mgmt)"
            value={fmt(aquacultureSummary.total_management_profit_bdt)}
            subtitle="May differ from GL pond tags"
            icon={Percent}
            iconClass="bg-teal-700"
          />
        </div>
      ) : null}

      {stationNetIncomeBars.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white p-4 shadow-sm ring-1 ring-slate-200/50 md:p-6">
          <div className="mb-4 flex items-start gap-3">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-neutral-900">Net income by station</h2>
              <p className="mt-1 max-w-2xl text-sm text-neutral-600">
                Posted GL P&L and non-draft invoice sales per fuel site for the selected period.
              </p>
            </div>
          </div>
          <div className={CHART_STANDARD}>
            <ResponsiveContainer width="100%" height="100%" debounce={50}>
              <BarChart data={stationNetIncomeBars} margin={M_BAR_X}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  angle={stationNetIncomeBars.length > 4 ? -28 : 0}
                  textAnchor={stationNetIncomeBars.length > 4 ? 'end' : 'middle'}
                  height={stationNetIncomeBars.length > 4 ? 56 : 28}
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickFormatter={(v) => fmt(Number(v))}
                  width={Y_AXIS_CURRENCY_W}
                />
                <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ maxWidth: 300 }} />
                <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="net_income" name="Net income (GL)" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="document_sales" name="Invoice sales" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <StationListTable rows={byStation} fmt={fmt} totalLabel={stationTotalLabel} />
        </div>
      ) : null}

      {pondPerformanceBars.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-teal-200/90 bg-white p-4 shadow-sm ring-1 ring-teal-100/80 md:p-6">
          <div className="mb-4 flex items-start gap-3">
            <Fish className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" aria-hidden />
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-neutral-900">Pond performance</h2>
              <p className="mt-1 max-w-2xl text-sm text-neutral-600">
                Registered pond sales and aquaculture management P&L (BDT) vs pond-tagged GL net income.
              </p>
            </div>
          </div>
          <div className={CHART_STANDARD}>
            <ResponsiveContainer width="100%" height="100%" debounce={50}>
              <BarChart data={pondPerformanceBars} margin={M_BAR_X}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  angle={pondPerformanceBars.length > 4 ? -28 : 0}
                  textAnchor={pondPerformanceBars.length > 4 ? 'end' : 'middle'}
                  height={pondPerformanceBars.length > 4 ? 56 : 28}
                  interval={0}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748b' }}
                  tickFormatter={(v) => fmt(Number(v))}
                  width={Y_AXIS_CURRENCY_W}
                />
                <Tooltip formatter={(v: number) => fmt(v)} contentStyle={{ maxWidth: 320 }} />
                <Legend verticalAlign="bottom" wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="management_revenue" name="Mgmt revenue (BDT)" fill="#14b8a6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="management_profit" name="Mgmt profit (BDT)" fill="#0d9488" radius={[4, 4, 0, 0]} />
                <Bar dataKey="pond_sales" name="Pond sales register" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                <Bar dataKey="net_income_gl" name="Net income (GL tag)" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <PondListTable rows={byPond} fmt={fmt} totalLabel={pondTotalLabel} />
        </div>
      ) : null}
    </div>
  )
}
