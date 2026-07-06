'use client'

import type { ReactNode } from 'react'
import { formatCurrency } from '@/utils/formatting'
import {
  DrillAmount,
  glAccountDrill,
  useReportDrill,
  type AgingDrillDocument,
  type ReportDrillTarget,
} from '@/components/reports/ReportDrillContext'
import { ReportAmountCell } from '@/components/reports/ReportAmountCell'
import {
  PondScopedAquaculturePlBlock,
} from '@/components/reports/AquaculturePlCategoryMatrices'
import { agingBucketTotalRow } from '@/components/reports/reportDrillAggregate'

type ReportType =
  | 'ar-aging'
  | 'ap-aging'
  | 'cash-flow'
  | 'expense-detail'
  | 'income-detail'
  | 'stations-financial-summary'
  | 'fuel-stations-pl-summary'
  | 'shop-hubs-pl-summary'
  | 'ponds-pl-summary'
  | 'entities-pl-summary'
  | 'entities-balance-sheet-summary'
  | 'entities-trial-balance-summary'
  | 'entities-financial-summary'

function filterPondEntityRows(
  rows: Record<string, unknown>[],
  pondId?: number | null,
): Record<string, unknown>[] {
  if (pondId == null || pondId <= 0) return rows
  return rows.filter((r) => Number(r.pond_id ?? r.entity_id ?? 0) === pondId)
}

function filterStationEntityRows(
  rows: Record<string, unknown>[],
  stationId?: number | null,
): Record<string, unknown>[] {
  if (stationId == null || stationId <= 0) return rows
  return rows.filter((r) => Number(r.station_id ?? r.entity_id ?? 0) === stationId)
}

function stationEntityName(
  rows: Record<string, unknown>[],
  stationId?: number | null,
): string | null {
  if (stationId == null || stationId <= 0) return null
  const row = rows.find((r) => Number(r.station_id ?? r.entity_id ?? 0) === stationId)
  return row ? String(row.station_name ?? row.entity_name ?? `Station #${stationId}`) : null
}

function pondEntityName(
  rows: Record<string, unknown>[],
  pondId?: number | null,
): string | null {
  if (pondId == null || pondId <= 0) return null
  const row = rows.find((r) => Number(r.pond_id ?? r.entity_id ?? 0) === pondId)
  return row ? String(row.pond_name ?? row.entity_name ?? `Pond #${pondId}`) : null
}

function entitySections(data: Record<string, unknown>) {
  const byFuel =
    (data.by_fuel_station as Record<string, unknown>[]) ??
    (data.fuel_stations as Record<string, unknown>[]) ??
    []
  const byShop =
    (data.by_shop_hub as Record<string, unknown>[]) ??
    (data.shop_hubs as Record<string, unknown>[]) ??
    []
  const byStation = (data.by_station as Record<string, unknown>[]) ?? []
  return {
    byFuelStation: byFuel.length ? byFuel : byStation.filter((r) => r.business_kind === 'fuel_station'),
    byShopHub: byShop.length ? byShop : byStation.filter((r) => r.business_kind === 'shop_hub'),
    byStation,
    byPond: (data.by_pond as Record<string, unknown>[]) ?? [],
    unscoped: data.unscoped as Record<string, unknown> | undefined,
    fuelStationsTotal:
      (data.fuel_stations_total as Record<string, unknown>) ??
      (data.segment_totals as { fuel_stations?: Record<string, unknown> })?.fuel_stations,
    shopHubsTotal:
      (data.shop_hubs_total as Record<string, unknown>) ??
      (data.segment_totals as { shop_hubs?: Record<string, unknown> })?.shop_hubs,
    stationsTotal:
      (data.stations_total as Record<string, unknown>) ??
      (data.segment_totals as { all_stations?: Record<string, unknown> })?.all_stations,
    pondsTotal:
      (data.ponds_total as Record<string, unknown>) ??
      (data.segment_totals as { ponds?: Record<string, unknown> })?.ponds,
    companyTotal: (data.company_total as Record<string, unknown>) ?? {},
    bsAsOf: String(data.balance_sheet_as_of ?? (data.period as { end_date?: string })?.end_date ?? ''),
  }
}

type EntityPlDrillHandler = (entityType: 'station' | 'pond', entityId: number) => void

function entityPlTable(
  title: string,
  rows: Record<string, unknown>[],
  entityKind: 'station' | 'pond',
  onViewDetail?: EntityPlDrillHandler,
  drillScope?: {
    startDate?: string
    endDate?: string
    stationId?: number | null
    pondId?: number | null
  },
) {
  const colSpan = onViewDetail ? 7 : 6
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <h3 className="bg-muted/40 px-4 py-3 text-sm font-semibold text-foreground border-b">{title}</h3>
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-muted/40">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Entity</th>
            <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Income</th>
            <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground uppercase">COGS</th>
            <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Expenses</th>
            <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Gross</th>
            <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Net income</th>
            {onViewDetail ? (
              <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Detail</th>
            ) : null}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-border">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-muted-foreground">
                {entityKind === 'station'
                  ? 'No stations with posted P&L activity in this period.'
                  : 'No ponds with posted GL activity in this period.'}
              </td>
            </tr>
          ) : (
            rows.map((r) => {
              const entityId =
                entityKind === 'station'
                  ? Number(r.station_id ?? r.entity_id ?? 0)
                  : Number(r.pond_id ?? r.entity_id ?? 0)
              return (
                <tr key={`pl-${String(r.entity_type)}-${String(r.entity_id ?? 'u')}`} className="hover:bg-muted/40">
                  <td className="px-4 py-3 font-medium text-foreground">
                    <div>{String(r.entity_name ?? '')}</div>
                    {entityKind === 'station' && r.business_kind_label ? (
                      <div className="mt-0.5 text-xs font-normal text-muted-foreground">{String(r.business_kind_label)}</div>
                    ) : null}
                    {entityKind === 'station' && r.combined_shop_gross_profit != null ? (
                      <div className="mt-1 text-xs text-primary">
                        Shop total (incl. sales to ponds): gross{' '}
                        {formatCurrency(Number(r.combined_shop_gross_profit ?? 0))}
                      </div>
                    ) : null}
                    {entityKind === 'pond' && r.pond_open_ar_bdt != null ? (
                      <div className="mt-1 text-xs text-muted-foreground">
                        AR {formatCurrency(Number(r.pond_open_ar_bdt ?? 0))} · AP{' '}
                        {formatCurrency(Number(r.pond_open_ap_bdt ?? 0))} · Stock{' '}
                        {formatCurrency(Number(r.pond_warehouse_inventory_value_bdt ?? 0))}
                      </div>
                    ) : null}
                    {entityKind === 'pond' &&
                    (r.management_feed_consumption_bdt != null ||
                      r.management_medicine_consumption_bdt != null) ? (
                      <div className="mt-1 text-xs text-primary">
                        Mgmt P&amp;L — feed {formatCurrency(Number(r.management_feed_consumption_bdt ?? 0))} · med{' '}
                        {formatCurrency(Number(r.management_medicine_consumption_bdt ?? 0))} · other cons.{' '}
                        {formatCurrency(Number(r.management_other_consumption_bdt ?? 0))} · total costs{' '}
                        {formatCurrency(Number(r.management_total_costs_bdt ?? 0))}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <ReportAmountCell amount={Number(r.income ?? 0)} row={r} field="income" scope={drillScope} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <ReportAmountCell amount={Number(r.cost_of_goods_sold ?? 0)} row={r} field="cost_of_goods_sold" scope={drillScope} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <ReportAmountCell amount={Number(r.expenses ?? 0)} row={r} field="expenses" scope={drillScope} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    <ReportAmountCell amount={Number(r.gross_profit ?? 0)} row={r} field="gross_profit" scope={drillScope} />
                  </td>
                  <td className="px-3 py-3 text-right font-semibold">
                    <ReportAmountCell amount={Number(r.net_income ?? 0)} row={r} field="net_income" scope={drillScope} />
                  </td>
                  {onViewDetail && entityId > 0 ? (
                    <td className="px-3 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => onViewDetail(entityKind, entityId)}
                        className="text-sm font-medium text-primary hover:text-blue-900 underline"
                      >
                        Full P&L
                      </button>
                    </td>
                  ) : onViewDetail ? (
                    <td className="px-3 py-3" />
                  ) : null}
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

function entityBsTable(title: string, rows: Record<string, unknown>[], bsAsOf: string, drillScope?: { startDate?: string; endDate?: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <h3 className="bg-muted/40 px-4 py-3 text-sm font-semibold text-foreground border-b">
        {title}
        {bsAsOf ? <span className="ml-2 font-normal text-muted-foreground">(as of {bsAsOf})</span> : null}
      </h3>
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-muted/40">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Entity</th>
            <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Assets</th>
            <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Liabilities</th>
            <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Equity</th>
            <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground uppercase">L + E</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-border">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                No balance sheet balances for entities in this period.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={`bs-${String(r.entity_type)}-${String(r.entity_id ?? 'u')}`} className="hover:bg-muted/40">
                <td className="px-4 py-3 font-medium text-foreground">{String(r.entity_name ?? '')}</td>
                <td className="px-3 py-3 text-right">
                  <ReportAmountCell amount={Number(r.total_assets ?? 0)} row={r} field="total_assets" scope={drillScope} />
                </td>
                <td className="px-3 py-3 text-right">
                  <ReportAmountCell amount={Number(r.total_liabilities ?? 0)} row={r} field="total_liabilities" scope={drillScope} />
                </td>
                <td className="px-3 py-3 text-right">
                  <ReportAmountCell amount={Number(r.total_equity ?? 0)} row={r} field="total_equity" scope={drillScope} />
                </td>
                <td className="px-3 py-3 text-right">
                  <ReportAmountCell amount={Number(r.total_liabilities_and_equity ?? 0)} row={r} field="total_liabilities_and_equity" scope={drillScope} />
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function entityTbTable(
  title: string,
  rows: Record<string, unknown>[],
  drillScope?: { startDate?: string; endDate?: string; stationId?: number | null; pondId?: number | null },
) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <h3 className="bg-muted/40 px-4 py-3 text-sm font-semibold text-foreground border-b">{title}</h3>
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-muted/40">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Entity</th>
            <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Debits</th>
            <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Credits</th>
            <th className="px-3 py-3 text-center text-xs font-medium text-muted-foreground uppercase">Balanced</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-border">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                No trial balance activity for entities in this period.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={`tb-${String(r.entity_type)}-${String(r.entity_id ?? 'u')}`} className="hover:bg-muted/40">
                <td className="px-4 py-3 font-medium text-foreground">{String(r.entity_name ?? '')}</td>
                <td className="px-3 py-3 text-right">
                  <ReportAmountCell amount={Number(r.trial_balance_debit ?? 0)} row={r} field="trial_balance_debit" scope={drillScope} />
                </td>
                <td className="px-3 py-3 text-right">
                  <ReportAmountCell amount={Number(r.trial_balance_credit ?? 0)} row={r} field="trial_balance_credit" scope={drillScope} />
                </td>
                <td className="px-3 py-3 text-center text-xs">{r.trial_balance_balanced ? 'Yes' : 'No'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function segmentPlTotalsCard(
  title: string,
  totals: Record<string, unknown> | undefined,
  drillScope?: { startDate?: string; endDate?: string; stationId?: number | null; pondId?: number | null },
) {
  if (!totals || Object.keys(totals).length === 0) return null
  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-sm">
        <div>
          <p className="text-muted-foreground">Income</p>
          <p className="font-semibold">
            <ReportAmountCell amount={Number(totals.income ?? 0)} row={totals} field="income" scope={drillScope} />
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">COGS</p>
          <p className="font-semibold">
            <ReportAmountCell amount={Number(totals.cost_of_goods_sold ?? 0)} row={totals} field="cost_of_goods_sold" scope={drillScope} />
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Expenses</p>
          <p className="font-semibold">
            <ReportAmountCell amount={Number(totals.expenses ?? 0)} row={totals} field="expenses" scope={drillScope} />
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Gross profit</p>
          <p className="font-semibold">
            <ReportAmountCell amount={Number(totals.gross_profit ?? 0)} row={totals} field="gross_profit" scope={drillScope} />
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Net income</p>
          <p className="font-semibold">
            <ReportAmountCell amount={Number(totals.net_income ?? 0)} row={totals} field="net_income" scope={drillScope} />
          </p>
        </div>
      </div>
    </div>
  )
}

function renderEntitySectionTables(
  kind: 'pl' | 'bs' | 'tb',
  sections: ReturnType<typeof entitySections>,
  onViewEntityPl?: EntityPlDrillHandler,
  drillScope?: {
    startDate?: string
    endDate?: string
    stationId?: number | null
    pondId?: number | null
    headOffice?: boolean
  },
  reportData?: Record<string, unknown>,
) {
  const {
    byFuelStation,
    byShopHub,
    byStation,
    byPond,
    unscoped,
    bsAsOf,
    fuelStationsTotal,
    shopHubsTotal,
    pondsTotal,
  } = sections
  const pondScopeId = drillScope?.pondId ?? null
  const stationScopeId = drillScope?.stationId ?? null
  const headOfficeScope = drillScope?.headOffice === true
  const scopedByPond = filterPondEntityRows(byPond, pondScopeId)
  const scopedPondGlTotal =
    pondScopeId && scopedByPond.length === 1
      ? (scopedByPond[0] as Record<string, unknown>)
      : pondsTotal
  const fuelStations = byFuelStation.length ? byFuelStation : byStation.filter((r) => r.business_kind !== 'shop_hub')
  const shopHubs = byShopHub.length ? byShopHub : byStation.filter((r) => r.business_kind === 'shop_hub')
  const scopedFuel = stationScopeId ? filterStationEntityRows(fuelStations, stationScopeId) : fuelStations
  const scopedShop = stationScopeId ? filterStationEntityRows(shopHubs, stationScopeId) : shopHubs
  const scopedFuelTotal =
    stationScopeId && scopedFuel.length === 1
      ? (scopedFuel[0] as Record<string, unknown>)
      : fuelStationsTotal
  const scopedShopTotal =
    stationScopeId && scopedShop.length === 1
      ? (scopedShop[0] as Record<string, unknown>)
      : shopHubsTotal
  const label =
    kind === 'pl' ? 'Profit & Loss' : kind === 'bs' ? 'Balance Sheet' : 'Trial Balance'

  const renderSection = (
    title: string,
    rows: Record<string, unknown>[],
    entityKind?: 'station' | 'pond',
    categoryTotal?: Record<string, unknown>,
    categoryTitle?: string,
  ) => {
    const table =
      kind === 'pl' && entityKind
        ? entityPlTable(title, rows, entityKind, onViewEntityPl, drillScope)
        : kind === 'bs'
          ? entityBsTable(title, rows, bsAsOf, drillScope)
          : entityTbTable(title, rows, drillScope)
    return (
      <div key={title} className="space-y-3">
        {table}
        {kind === 'pl' && categoryTotal
          ? segmentPlTotalsCard(categoryTitle ?? title, categoryTotal, drillScope)
          : null}
      </div>
    )
  }

  if (headOfficeScope) {
    return unscoped ? (
      <>
        {renderSection(
          `${label} — head office / unassigned`,
          [unscoped],
          undefined,
          unscoped as Record<string, unknown>,
          'Head office / unassigned',
        )}
      </>
    ) : (
      <p className="text-sm text-muted-foreground">No head office / unassigned activity in this period.</p>
    )
  }

  return (
    <>
      {!pondScopeId && !stationScopeId
        ? renderSection(
            `${label} — fuel filling stations`,
            fuelStations,
            'station',
            fuelStationsTotal,
            'Total — all fuel filling stations',
          )
        : null}
      {stationScopeId && scopedFuel.length > 0
        ? renderSection(
            `${label} — ${stationEntityName(fuelStations, stationScopeId) ?? 'fuel station'}`,
            scopedFuel,
            'station',
            scopedFuelTotal,
            stationEntityName(fuelStations, stationScopeId) ?? 'Total — station',
          )
        : null}
      {!pondScopeId && !stationScopeId
        ? renderSection(
            `${label} — shop hubs (no fuel)`,
            shopHubs,
            'station',
            shopHubsTotal,
            'Total — all shop hubs (no fuel)',
          )
        : null}
      {stationScopeId && scopedShop.length > 0
        ? renderSection(
            `${label} — ${stationEntityName(shopHubs, stationScopeId) ?? 'shop hub'}`,
            scopedShop,
            'station',
            scopedShopTotal,
            stationEntityName(shopHubs, stationScopeId) ?? 'Total — station',
          )
        : null}
      {!stationScopeId
        ? renderSection(
            pondScopeId
              ? `${label} — ${pondEntityName(byPond, pondScopeId) ?? 'pond'} (aquaculture, GL-tagged)`
              : `${label} — ponds (aquaculture, GL-tagged)`,
            scopedByPond,
            'pond',
            scopedPondGlTotal,
            pondScopeId ? pondEntityName(byPond, pondScopeId) ?? 'Total — pond' : 'Total — all ponds',
          )
        : null}
      {kind === 'pl' && !stationScopeId && scopedByPond.length > 0 ? (
        <PondScopedAquaculturePlBlock
          data={reportData}
          pondId={pondScopeId ?? (scopedByPond.length === 1 ? Number(scopedByPond[0]?.pond_id ?? scopedByPond[0]?.entity_id ?? 0) : null)}
          pondName={
            pondEntityName(byPond, pondScopeId) ??
            (scopedByPond.length === 1 ? String(scopedByPond[0]?.pond_name ?? scopedByPond[0]?.entity_name ?? '') : null)
          }
          pondRows={scopedByPond}
        />
      ) : null}
      {!pondScopeId && unscoped ? renderSection(`${label} — head office / unassigned`, [unscoped]) : null}
    </>
  )
}

type PeriodFilterProps = {
  period: { start_date?: string; end_date?: string }
  dateRange?: { startDate: string; endDate: string }
  reportType: string
  handleReportDateChange?: (field: 'startDate' | 'endDate', value: string, reportId?: string) => void
  hint: string
}

export function renderExtraFinancialReport(
  reportType: string,
  data: Record<string, unknown> | null | undefined,
  ctx: {
    hasPeriod: boolean
    renderPeriodFilter: (props: PeriodFilterProps) => ReactNode
    period: { start_date?: string; end_date?: string }
    dateRange?: { startDate: string; endDate: string }
    handleReportDateChange?: (field: 'startDate' | 'endDate', value: string, reportId?: string) => void
    onViewEntityPl?: EntityPlDrillHandler
    drillScope?: {
      startDate?: string
      endDate?: string
      stationId?: number | null
      pondId?: number | null
      headOffice?: boolean
    }
  },
): ReactNode | null {
  if (!data) return null

  const periodFilter = (hint: string) =>
    ctx.hasPeriod
      ? ctx.renderPeriodFilter({
          period: ctx.period,
          dateRange: ctx.dateRange,
          reportType,
          handleReportDateChange: ctx.handleReportDateChange,
          hint,
        })
      : null

  if (reportType === 'expense-detail') {
    const expenses = data.expenses as
      | { accounts?: { account_id?: number; account_code?: string; account_name?: string; balance?: number }[]; total?: number }
      | undefined
    const accounts = expenses?.accounts ?? []
    return (
      <div className="space-y-6">
        {periodFilter(
          'Operating expenses only (Income Statement expense section). COGS accounts (5100, 5120, etc.) appear on Profit & Loss under Cost of Goods Sold.'
        )}
        {typeof data.accounting_note === 'string' && (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground/85">{data.accounting_note}</p>
        )}
        <div className="bg-white border border-border rounded-lg shadow-sm">
          <div className="p-4 border-b bg-muted/40 flex justify-between">
            <h3 className="text-lg font-semibold text-foreground">Expenses</h3>
            <span className="text-sm font-bold text-foreground/85">
              <ReportAmountCell
                amount={Number(expenses?.total ?? 0)}
                row={
                  expenses?.accounts
                    ? {
                        _drill: {
                          total: {
                            kind: 'account-breakdown',
                            title: 'Expenses',
                            amountField: 'balance',
                            accounts: (expenses.accounts as { account_id?: number; account_code?: string; account_name?: string; balance?: number }[])
                              .filter((a) => Number(a.balance ?? 0) !== 0)
                              .map((a) => ({
                                account_id: Number(a.account_id),
                                account_code: a.account_code,
                                account_name: a.account_name,
                                amount: a.balance ?? 0,
                              })),
                          },
                        },
                      }
                    : undefined
                }
                field="total"
                scope={ctx.drillScope}
              />
            </span>
          </div>
          <div className="divide-y divide-border">
            {accounts.length > 0 ? (
              accounts.map((account, accIdx) => (
                <div
                  key={`exp-${accIdx}-${account.account_code ?? 'acct'}`}
                  className="px-4 py-3 flex justify-between hover:bg-muted/40"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{account.account_name}</p>
                    <p className="text-xs text-muted-foreground">{account.account_code}</p>
                  </div>
                  <p className="text-sm font-semibold text-foreground ml-4">
                    <DrillAmount
                      amount={Number(account.balance ?? 0)}
                      drill={glAccountDrill(account as { account_id?: number; account_code?: string; account_name?: string }, ctx.drillScope)}
                    />
                  </p>
                </div>
              ))
            ) : (
              <div className="px-4 py-8 text-center text-muted-foreground/70 text-sm">No expense activity in this period</div>
            )}
          </div>
        </div>
        <PondScopedAquaculturePlBlock
          data={data}
          pondId={ctx.drillScope?.pondId}
          pondName={
            typeof data.filter_pond_name === 'string'
              ? String(data.filter_pond_name)
              : null
          }
        />
      </div>
    )
  }

  if (reportType === 'income-detail') {
    const income = data.income as
      | { accounts?: { account_id?: number; account_code?: string; account_name?: string; balance?: number }[]; total?: number }
      | undefined
    const accounts = income?.accounts ?? []
    return (
      <div className="space-y-6">
        {periodFilter(
          'Income accounts only (Income Statement income section). COGS and operating expenses appear on Profit & Loss.'
        )}
        {typeof data.accounting_note === 'string' && (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground/85">{data.accounting_note}</p>
        )}
        <div className="bg-white border border-border rounded-lg shadow-sm">
          <div className="p-4 border-b bg-muted/40 flex justify-between">
            <h3 className="text-lg font-semibold text-foreground">Income</h3>
            <span className="text-sm font-bold text-foreground/85">
              <ReportAmountCell
                amount={Number(income?.total ?? 0)}
                row={
                  income?.accounts
                    ? {
                        _drill: {
                          total: {
                            kind: 'account-breakdown',
                            title: 'Income',
                            amountField: 'balance',
                            accounts: (income.accounts as { account_id?: number; account_code?: string; account_name?: string; balance?: number }[])
                              .filter((a) => Number(a.balance ?? 0) !== 0)
                              .map((a) => ({
                                account_id: Number(a.account_id),
                                account_code: a.account_code,
                                account_name: a.account_name,
                                amount: a.balance ?? 0,
                              })),
                          },
                        },
                      }
                    : undefined
                }
                field="total"
                scope={ctx.drillScope}
              />
            </span>
          </div>
          <div className="divide-y divide-border">
            {accounts.length > 0 ? (
              accounts.map((account, accIdx) => (
                <div
                  key={`inc-${accIdx}-${account.account_code ?? 'acct'}`}
                  className="px-4 py-3 flex justify-between hover:bg-muted/40"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{account.account_name}</p>
                    <p className="text-xs text-muted-foreground">{account.account_code}</p>
                  </div>
                  <p className="text-sm font-semibold text-foreground ml-4">
                    <DrillAmount
                      amount={Number(account.balance ?? 0)}
                      drill={glAccountDrill(account as { account_id?: number; account_code?: string; account_name?: string }, ctx.drillScope)}
                    />
                  </p>
                </div>
              ))
            ) : (
              <div className="px-4 py-8 text-center text-muted-foreground/70 text-sm">No income activity in this period</div>
            )}
          </div>
        </div>
        <PondScopedAquaculturePlBlock
          data={data}
          pondId={ctx.drillScope?.pondId}
          pondName={
            typeof data.filter_pond_name === 'string'
              ? String(data.filter_pond_name)
              : null
          }
        />
      </div>
    )
  }

  if (reportType === 'cash-flow') {
    const banks = (data.bank_accounts as Record<string, unknown>[]) ?? []
    const op = (data.operating as Record<string, number>) ?? {}
    const cash = (data.cash_summary as Record<string, number>) ?? {}
    const byStation = (data.by_station as Record<string, unknown>[]) ?? []
    const byFuel =
      (data.by_fuel_station as Record<string, unknown>[]) ??
      byStation.filter((r) => r.business_kind !== 'shop_hub')
    const byShop =
      (data.by_shop_hub as Record<string, unknown>[]) ??
      byStation.filter((r) => r.business_kind === 'shop_hub')
    const byPond = (data.by_pond as Record<string, unknown>[]) ?? []
    const unscoped = data.unscoped as Record<string, unknown> | undefined
    const showEntities = byStation.length > 0 || byPond.length > 0

    const entityTable = (title: string, rows: Record<string, unknown>[], pondCols: boolean) => (
      <div className="overflow-x-auto rounded-lg border border-border">
        <h3 className="bg-muted/40 px-4 py-3 text-sm font-semibold text-foreground border-b">{title}</h3>
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Entity</th>
              <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Net income</th>
              <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground uppercase whitespace-nowrap">
                {pondCols ? 'Pond sales' : 'Customer rcpts'}
              </th>
              <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground uppercase whitespace-nowrap">Vendor pmt</th>
              <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Net cash change</th>
              <th className="px-3 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Ending cash</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-border">
            {rows.map((r) => (
              <tr key={`${String(r.entity_type)}-${String(r.entity_id ?? 'u')}`} className="hover:bg-muted/40">
                <td className="px-4 py-3 font-medium text-foreground">{String(r.entity_name ?? '')}</td>
                <td className="px-3 py-3 text-right">
                  <ReportAmountCell amount={Number(r.net_income ?? 0)} row={r} field="net_income" scope={ctx.drillScope} />
                </td>
                <td className="px-3 py-3 text-right text-success">
                  <ReportAmountCell amount={Number(r.customer_payments_received ?? 0)} row={r} field="customer_payments_received" scope={ctx.drillScope} />
                </td>
                <td className="px-3 py-3 text-right text-destructive">
                  <ReportAmountCell amount={Number(r.vendor_payments_made ?? 0)} row={r} field="vendor_payments_made" scope={ctx.drillScope} />
                </td>
                <td className="px-3 py-3 text-right font-medium">
                  <ReportAmountCell amount={Number(r.net_change_in_cash ?? 0)} row={r} field="net_change_in_cash" scope={ctx.drillScope} />
                </td>
                <td className="px-3 py-3 text-right">
                  <ReportAmountCell amount={Number(r.ending_cash ?? 0)} row={r} field="ending_cash" scope={ctx.drillScope} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )

    return (
      <div className="space-y-6">
        {periodFilter('Company cash flow; clear the site filter to see every station and pond.')}
        {typeof data.accounting_note === 'string' && (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground/85">{data.accounting_note}</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white border rounded-lg p-4 shadow-sm">
            <p className="text-xs text-muted-foreground uppercase">Net income (P&L)</p>
            <p className="text-xl font-bold mt-1"><ReportAmountCell amount={Number(op.net_income ?? 0)} row={op} field="net_income" scope={ctx.drillScope ?? {}} /></p>
          </div>
          <div className="bg-white border rounded-lg p-4 shadow-sm">
            <p className="text-xs text-muted-foreground uppercase">Customer payments received</p>
            <p className="text-xl font-bold mt-1 text-success"><ReportAmountCell amount={Number(op.customer_payments_received ?? 0)} row={op} field="customer_payments_received" scope={ctx.drillScope ?? {}} /></p>
          </div>
          <div className="bg-white border rounded-lg p-4 shadow-sm">
            <p className="text-xs text-muted-foreground uppercase">Vendor payments made</p>
            <p className="text-xl font-bold mt-1 text-destructive"><ReportAmountCell amount={Number(op.vendor_payments_made ?? 0)} row={op} field="vendor_payments_made" scope={ctx.drillScope ?? {}} /></p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-accent to-card border border-primary/25 rounded-lg p-4">
            <p className="text-xs text-primary uppercase">Beginning cash</p>
            <p className="text-2xl font-bold text-blue-900 mt-1"><ReportAmountCell amount={Number(cash.beginning_cash ?? 0)} row={cash} field="beginning_cash" scope={ctx.drillScope ?? {}} /></p>
          </div>
          <div className="bg-gradient-to-br from-muted/40 to-card border border-border rounded-lg p-4">
            <p className="text-xs text-muted-foreground uppercase">Net change in cash</p>
            <p className="text-2xl font-bold text-foreground mt-1"><ReportAmountCell amount={Number(cash.net_change_in_cash ?? 0)} row={cash} field="net_change_in_cash" scope={ctx.drillScope ?? {}} /></p>
          </div>
          <div className="bg-gradient-to-br from-green-50 to-card border border-success/25 rounded-lg p-4">
            <p className="text-xs text-success uppercase">Ending cash</p>
            <p className="text-2xl font-bold text-green-900 mt-1"><ReportAmountCell amount={Number(cash.ending_cash ?? 0)} row={cash} field="ending_cash" scope={ctx.drillScope ?? {}} /></p>
          </div>
        </div>

        {showEntities ? (
          <div className="space-y-6">
            <p className="text-sm font-semibold text-foreground">Cash flow by entity (each station, shop hub, and pond)</p>
            {entityTable('Fuel filling stations', byFuel, false)}
            {entityTable('Shop hubs (no fuel)', byShop, false)}
            {byPond.length > 0 ? entityTable('Ponds (pond-tagged bank GL + registered sales)', byPond, true) : null}
            {unscoped ? entityTable('Head office / unassigned', [unscoped], false) : null}
          </div>
        ) : null}

        <div className="overflow-x-auto rounded-lg border border-border">
          <h3 className="bg-muted/40 px-4 py-3 text-sm font-semibold text-foreground border-b">Bank accounts (company)</h3>
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">Bank account</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Beginning</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Deposits</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Withdrawals</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Ending</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-border">
              {banks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No bank_account chart rows with activity in this period.
                  </td>
                </tr>
              ) : (
                banks.map((b, i) => (
                  <tr key={`bank-${i}-${String(b.account_code ?? '')}`} className="hover:bg-muted/40">
                    <td className="px-4 py-3 text-sm">
                      <div className="font-medium text-foreground">{String(b.account_name ?? '')}</div>
                      <div className="text-xs text-muted-foreground">{String(b.account_code ?? '')}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-right">
                      <ReportAmountCell amount={Number(b.beginning_balance ?? 0)} row={b} field="beginning_balance" scope={ctx.drillScope} />
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-success">
                      <ReportAmountCell amount={Number(b.deposits ?? 0)} row={b} field="deposits" scope={ctx.drillScope} />
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-destructive">
                      <ReportAmountCell amount={Number(b.withdrawals ?? 0)} row={b} field="withdrawals" scope={ctx.drillScope} />
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium">
                      <ReportAmountCell amount={Number(b.ending_balance ?? 0)} row={b} field="ending_balance" scope={ctx.drillScope} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const entityReportIds = [
    'entities-pl-summary',
    'entities-balance-sheet-summary',
    'entities-trial-balance-summary',
    'entities-financial-summary',
  ] as const
  if (entityReportIds.includes(reportType as (typeof entityReportIds)[number])) {
    const sections = entitySections(data)
    const co = sections.companyTotal
    const pondScopeId = ctx.drillScope?.pondId ?? null
    const stationScopeId = ctx.drillScope?.stationId ?? null
    const headOfficeScope = ctx.drillScope?.headOffice === true
    const scopedPondRow =
      pondScopeId != null
        ? filterPondEntityRows(sections.byPond, pondScopeId)[0]
        : undefined
    const allStations = [...sections.byFuelStation, ...sections.byShopHub, ...sections.byStation]
    const scopedStationRow =
      stationScopeId != null
        ? filterStationEntityRows(allStations, stationScopeId)[0]
        : undefined
    const isCombined = reportType === 'entities-financial-summary'
    const kind = isCombined
      ? 'combined'
      : reportType === 'entities-pl-summary'
        ? 'pl'
        : reportType === 'entities-balance-sheet-summary'
          ? 'bs'
          : 'tb'
    const periodHints: Record<string, string> = {
      combined:
        'Combined P&L and balance sheet for every station, pond, and head office. Prefer the three separate entity reports for focused review.',
      pl: 'Individual P&L per station and per pond (separate tables). Use Full P&L on a row for account detail. Clear Site scope.',
      bs: 'Balance sheet totals as of the period end date for every entity. Clear the site filter.',
      tb: 'Posted debits and credits in the period for every entity. Clear the site filter.',
    }
    return (
      <div className="space-y-8">
        {periodFilter(periodHints[kind])}
        {typeof data.accounting_note === 'string' && (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground/85">{data.accounting_note}</p>
        )}
        {isCombined ? (
          <>
            {renderEntitySectionTables('pl', sections, ctx.onViewEntityPl, ctx.drillScope, data)}
            {renderEntitySectionTables('bs', sections, ctx.onViewEntityPl, ctx.drillScope, data)}
          </>
        ) : (
          renderEntitySectionTables(kind as 'pl' | 'bs' | 'tb', sections, ctx.onViewEntityPl, ctx.drillScope, data)
        )}
        {kind === 'pl' && data.segment_totals && !pondScopeId && !stationScopeId && !headOfficeScope ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {segmentPlTotalsCard('Total — fuel filling stations', (data.segment_totals as Record<string, unknown>).fuel_stations as Record<string, unknown>, ctx.drillScope)}
            {segmentPlTotalsCard('Total — shop hubs (no fuel)', (data.segment_totals as Record<string, unknown>).shop_hubs as Record<string, unknown>, ctx.drillScope)}
            {segmentPlTotalsCard('Total — all stations', (data.segment_totals as Record<string, unknown>).all_stations as Record<string, unknown>, ctx.drillScope)}
            {segmentPlTotalsCard('Total — all ponds', (data.segment_totals as Record<string, unknown>).ponds as Record<string, unknown>, ctx.drillScope)}
          </div>
        ) : null}
        {pondScopeId && scopedPondRow && (kind === 'pl' || isCombined) ? (
          segmentPlTotalsCard(
            pondEntityName(sections.byPond, pondScopeId) ?? 'Selected pond',
            scopedPondRow as Record<string, unknown>,
            ctx.drillScope,
          )
        ) : null}
        {stationScopeId && scopedStationRow && (kind === 'pl' || isCombined) ? (
          segmentPlTotalsCard(
            stationEntityName(allStations, stationScopeId) ?? 'Selected site',
            scopedStationRow as Record<string, unknown>,
            ctx.drillScope,
          )
        ) : null}
        {headOfficeScope && sections.unscoped && (kind === 'pl' || isCombined) ? (
          segmentPlTotalsCard(
            'Head office / unassigned',
            sections.unscoped as Record<string, unknown>,
            ctx.drillScope,
          )
        ) : null}
        {!pondScopeId && !stationScopeId && !headOfficeScope ? (
        <div className="rounded-lg border-2 border-border bg-muted/40 p-4">
          <h3 className="text-sm font-semibold text-foreground">Company total (all GL)</h3>
          {kind === 'pl' || isCombined ? (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">Income</p>
                <p className="font-semibold"><ReportAmountCell amount={Number(co.income ?? 0)} row={{ _drill: { income: { kind: 'scoped-pl', label: 'Company income' } } }} field="income" scope={ctx.drillScope ?? {}} /></p>
              </div>
              <div>
                <p className="text-muted-foreground">COGS</p>
                <p className="font-semibold"><ReportAmountCell amount={Number(co.cost_of_goods_sold ?? 0)} row={{ _drill: { cost_of_goods_sold: { kind: 'scoped-pl', label: 'Company COGS' } } }} field="cost_of_goods_sold" scope={ctx.drillScope ?? {}} /></p>
              </div>
              <div>
                <p className="text-muted-foreground">Expenses</p>
                <p className="font-semibold"><ReportAmountCell amount={Number(co.expenses ?? 0)} row={{ _drill: { expenses: { kind: 'scoped-pl', label: 'Company expenses' } } }} field="expenses" scope={ctx.drillScope ?? {}} /></p>
              </div>
              <div>
                <p className="text-muted-foreground">Gross profit</p>
                <p className="font-semibold"><ReportAmountCell amount={Number(co.gross_profit ?? 0)} row={{ _drill: { gross_profit: { kind: 'scoped-pl', label: 'Company gross profit' } } }} field="gross_profit" scope={ctx.drillScope ?? {}} /></p>
              </div>
              <div>
                <p className="text-muted-foreground">Net income</p>
                <p className="font-semibold"><ReportAmountCell amount={Number(co.net_income ?? 0)} row={{ _drill: { net_income: { kind: 'scoped-pl', label: 'Company net income' } } }} field="net_income" scope={ctx.drillScope ?? {}} /></p>
              </div>
            </div>
          ) : null}
          {kind === 'bs' || isCombined ? (
            <div className={`mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm ${isCombined ? 'border-t border-border pt-4' : ''}`}>
              <div>
                <p className="text-muted-foreground">Assets</p>
                <p className="font-semibold"><ReportAmountCell amount={Number(co.total_assets ?? 0)} row={{ _drill: { total_assets: { kind: 'scoped-pl', label: 'Company assets' } } }} field="total_assets" scope={ctx.drillScope ?? {}} /></p>
              </div>
              <div>
                <p className="text-muted-foreground">Liabilities</p>
                <p className="font-semibold"><ReportAmountCell amount={Number(co.total_liabilities ?? 0)} row={{ _drill: { total_liabilities: { kind: 'scoped-pl', label: 'Company liabilities' } } }} field="total_liabilities" scope={ctx.drillScope ?? {}} /></p>
              </div>
              <div>
                <p className="text-muted-foreground">Equity</p>
                <p className="font-semibold"><ReportAmountCell amount={Number(co.total_equity ?? 0)} row={{ _drill: { total_equity: { kind: 'scoped-pl', label: 'Company equity' } } }} field="total_equity" scope={ctx.drillScope ?? {}} /></p>
              </div>
              <div>
                <p className="text-muted-foreground">L + E</p>
                <p className="font-semibold"><ReportAmountCell amount={Number(co.total_liabilities_and_equity ?? 0)} row={{ _drill: { total_liabilities_and_equity: { kind: 'scoped-pl', label: 'Company L + E' } } }} field="total_liabilities_and_equity" scope={ctx.drillScope ?? {}} /></p>
              </div>
            </div>
          ) : kind === 'tb' ? (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-muted-foreground">TB debits</p>
                <p className="font-semibold"><ReportAmountCell amount={Number(co.trial_balance_debit ?? 0)} row={{ _drill: { trial_balance_debit: { kind: 'scoped-pl', label: 'Company TB debits' } } }} field="trial_balance_debit" scope={ctx.drillScope ?? {}} /></p>
              </div>
              <div>
                <p className="text-muted-foreground">TB credits</p>
                <p className="font-semibold"><ReportAmountCell amount={Number(co.trial_balance_credit ?? 0)} row={{ _drill: { trial_balance_credit: { kind: 'scoped-pl', label: 'Company TB credits' } } }} field="trial_balance_credit" scope={ctx.drillScope ?? {}} /></p>
              </div>
              <div>
                <p className="text-muted-foreground">Balanced</p>
                <p className="font-semibold">{co.trial_balance_balanced ? 'Yes' : 'No'}</p>
              </div>
            </div>
          ) : null}
        </div>
        ) : null}
      </div>
    )
  }

  if (
    reportType === 'stations-financial-summary' ||
    reportType === 'fuel-stations-pl-summary' ||
    reportType === 'shop-hubs-pl-summary' ||
    reportType === 'ponds-pl-summary'
  ) {
    const isPond = reportType === 'ponds-pl-summary'
    const isFuelOnly = reportType === 'fuel-stations-pl-summary'
    const isShopOnly = reportType === 'shop-hubs-pl-summary'
    const pondScopeId = ctx.drillScope?.pondId ?? null
    const stationScopeId = ctx.drillScope?.stationId ?? null
    const allPondRows = (isPond
      ? (data.ponds as Record<string, unknown>[])
      : isFuelOnly
        ? (data.fuel_stations as Record<string, unknown>[])
        : isShopOnly
          ? (data.shop_hubs as Record<string, unknown>[])
          : (data.stations as Record<string, unknown>[])) ?? []
    const rows = isPond
      ? filterPondEntityRows(allPondRows, pondScopeId)
      : stationScopeId
        ? filterStationEntityRows(allPondRows, stationScopeId)
        : allPondRows
    const fuelRows = (data.fuel_stations as Record<string, unknown>[]) ?? []
    const shopRows = (data.shop_hubs as Record<string, unknown>[]) ?? []
    const segmentTotals = (data.segment_totals as Record<string, Record<string, unknown>>) ?? {}
    const entityTotal = (isPond
      ? pondScopeId && rows.length === 1
        ? rows[0]
        : data.ponds_total ?? data.category_total
      : isFuelOnly || isShopOnly
        ? data.category_total
        : data.stations_total) as Record<string, unknown> | undefined
    const co = (data.company_total as Record<string, number>) ?? {}
    const periodHint = isPond
      ? 'Individual P&L per pond (each pond is its own entity). Use Site scope or Full P&L for one pond.'
      : isFuelOnly
        ? 'Individual P&L per fuel filling station. Use Site scope or Full P&L for one station.'
        : isShopOnly
          ? 'Individual P&L per shop/agro hub (station without fuel). Use Site scope or Full P&L for one hub.'
          : 'Individual P&L per station. Fuel stations and shop hubs (no fuel) are separate entities.'
    return (
      <div className="space-y-6">
        {periodFilter(periodHint)}
        {typeof data.accounting_note === 'string' && (
          <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground/85">{data.accounting_note}</p>
        )}
        {isPond ? (
          entityPlTable(
            pondScopeId ? pondEntityName(allPondRows, pondScopeId) ?? 'Pond' : 'Ponds',
            rows,
            'pond',
            ctx.onViewEntityPl,
            ctx.drillScope,
          )
        ) : isFuelOnly ? (
          entityPlTable('Fuel filling stations', rows, 'station', ctx.onViewEntityPl, ctx.drillScope)
        ) : isShopOnly ? (
          entityPlTable('Shop hubs (no fuel)', rows, 'station', ctx.onViewEntityPl, ctx.drillScope)
        ) : (
          <>
            {entityPlTable('Fuel filling stations', fuelRows.length > 0 ? fuelRows : rows.filter((r) => r.business_kind !== 'shop_hub'), 'station', ctx.onViewEntityPl, ctx.drillScope)}
            {entityPlTable('Shop hubs (no fuel)', shopRows, 'station', ctx.onViewEntityPl, ctx.drillScope)}
          </>
        )}
        {isPond ? (
          <PondScopedAquaculturePlBlock
            data={data}
            pondId={pondScopeId ?? (rows.length === 1 ? Number(rows[0]?.pond_id ?? rows[0]?.entity_id ?? 0) : null)}
            pondName={
              pondEntityName(allPondRows, pondScopeId) ??
              (rows.length === 1 ? String(rows[0]?.pond_name ?? rows[0]?.entity_name ?? '') : null)
            }
            pondRows={rows}
          />
        ) : null}
        {segmentPlTotalsCard(
          isPond
            ? pondScopeId
              ? pondEntityName(allPondRows, pondScopeId) ?? 'Total — pond'
              : 'Total — all ponds'
            : isFuelOnly
              ? 'Total — all fuel filling stations'
              : isShopOnly
                ? 'Total — all shop hubs (no fuel)'
                : 'Total — all stations',
          entityTotal ?? (isPond ? segmentTotals.ponds : isFuelOnly ? segmentTotals.fuel_stations : isShopOnly ? segmentTotals.shop_hubs : segmentTotals.all_stations),
          ctx.drillScope,
        )}
        {!isPond && !isFuelOnly && !isShopOnly ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {segmentPlTotalsCard('Total — fuel filling stations', segmentTotals.fuel_stations, ctx.drillScope)}
            {segmentPlTotalsCard('Total — shop hubs (no fuel)', segmentTotals.shop_hubs, ctx.drillScope)}
          </div>
        ) : null}
        {!pondScopeId && !stationScopeId ? (
        <div className="rounded-lg border-2 border-border bg-muted/40 p-4">
          <h3 className="text-sm font-semibold text-foreground">Company total (all GL)</h3>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground">Income</p>
              <p className="font-semibold"><ReportAmountCell amount={Number(co.income ?? 0)} row={{ _drill: { income: { kind: 'scoped-pl', label: 'Company income' } } }} field="income" scope={ctx.drillScope ?? {}} /></p>
            </div>
            <div>
              <p className="text-muted-foreground">COGS</p>
              <p className="font-semibold"><ReportAmountCell amount={Number(co.cost_of_goods_sold ?? 0)} row={{ _drill: { cost_of_goods_sold: { kind: 'scoped-pl', label: 'Company COGS' } } }} field="cost_of_goods_sold" scope={ctx.drillScope ?? {}} /></p>
            </div>
            <div>
              <p className="text-muted-foreground">Expenses</p>
              <p className="font-semibold"><ReportAmountCell amount={Number(co.expenses ?? 0)} row={{ _drill: { expenses: { kind: 'scoped-pl', label: 'Company expenses' } } }} field="expenses" scope={ctx.drillScope ?? {}} /></p>
            </div>
            <div>
              <p className="text-muted-foreground">Gross profit</p>
              <p className="font-semibold"><ReportAmountCell amount={Number(co.gross_profit ?? 0)} row={{ _drill: { gross_profit: { kind: 'scoped-pl', label: 'Company gross profit' } } }} field="gross_profit" scope={ctx.drillScope ?? {}} /></p>
            </div>
            <div>
              <p className="text-muted-foreground">Net income</p>
              <p className="font-semibold"><ReportAmountCell amount={Number(co.net_income ?? 0)} row={{ _drill: { net_income: { kind: 'scoped-pl', label: 'Company net income' } } }} field="net_income" scope={ctx.drillScope ?? {}} /></p>
            </div>
          </div>
        </div>
        ) : null}
      </div>
    )
  }

  if (reportType === 'ar-aging' || reportType === 'ap-aging') {
    return (
      <AgingReportTable
        reportType={reportType}
        data={data}
        periodFilter={periodFilter(`Open ${reportType === 'ar-aging' ? 'invoices' : 'bills'} aged as of the end date.`)}
        drillScope={ctx.drillScope}
      />
    )
  }

  return null
}

function AgingReportTable({
  reportType,
  data,
  periodFilter,
  drillScope,
}: {
  reportType: 'ar-aging' | 'ap-aging'
  data: Record<string, unknown>
  periodFilter: ReactNode
  drillScope?: {
    startDate?: string
    endDate?: string
    stationId?: number | null
    pondId?: number | null
  }
}) {
  const { push } = useReportDrill()
  const isAr = reportType === 'ar-aging'
  const parties = (isAr ? data.customers : data.vendors) as Record<string, unknown>[] | undefined
  const list = parties ?? []
  const totals = (data.totals as Record<string, number>) ?? {}
  const bucketLabels: { key: string; label: string }[] = [
    { key: 'current', label: 'Current' },
    { key: 'days_1_30', label: '1–30 days' },
    { key: 'days_31_60', label: '31–60 days' },
    { key: 'days_61_90', label: '61–90 days' },
    { key: 'days_over_90', label: '90+ days' },
  ]

  const pushDocuments = (
    party: Record<string, unknown>,
    bucketKey?: string,
    bucketLabel?: string,
  ) => {
    const docs = (party.documents as AgingDrillDocument[]) ?? []
    const filtered = bucketKey ? docs.filter((d) => d.bucket === bucketKey) : docs
    if (filtered.length === 0) return
    const partyName = String(party.display_name ?? '')
    push({
      kind: 'aging-documents',
      title: partyName,
      subtitle: bucketLabel
        ? `${bucketLabel} — open ${isAr ? 'invoices' : 'bills'} for ${partyName}`
        : `Open ${isAr ? 'invoices' : 'bills'} for ${partyName}`,
      entityType: isAr ? 'customers' : 'vendors',
      documents: filtered,
    })
  }

  const partyLedgerDrill = (party: Record<string, unknown>): ReportDrillTarget | null => {
    const entityId = Number(isAr ? party.customer_id : party.vendor_id)
    if (!entityId) return null
    return {
      kind: 'contact-ledger',
      entity: isAr ? 'customers' : 'vendors',
      entityId,
      label: String(party.display_name ?? ''),
      startDate: drillScope?.startDate,
      endDate: drillScope?.endDate,
    }
  }

  return (
    <div className="space-y-6">
      {periodFilter}
      {typeof data.accounting_note === 'string' && (
        <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground/85">{data.accounting_note}</p>
      )}
      <p className="text-xs text-muted-foreground">
        Click an amount to see underlying {isAr ? 'invoices' : 'bills'}. Use Back or Close in the detail window to return to this report.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase">
                {isAr ? 'Customer' : 'Vendor'}
              </th>
              {bucketLabels.map((b) => (
                <th
                  key={b.key}
                  className="px-3 py-3 text-right text-xs font-medium text-muted-foreground uppercase whitespace-nowrap"
                >
                  {b.label}
                </th>
              ))}
              <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase">Total</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-border">
            {list.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  No open {isAr ? 'receivables' : 'payables'} in aging buckets.
                </td>
              </tr>
            ) : (
              list.map((p, idx) => (
                <tr key={`${isAr ? 'ar' : 'ap'}-${idx}-${String(p.display_name ?? '')}`} className="hover:bg-muted/40">
                  <td className="px-4 py-3 font-medium text-foreground">
                    <button
                      type="button"
                      className="text-left hover:text-primary/80 hover:underline"
                      onClick={() => {
                        const drill = partyLedgerDrill(p)
                        if (drill) push(drill)
                      }}
                    >
                      {String(p.display_name ?? '')}
                    </button>
                  </td>
                  {bucketLabels.map((b) => {
                    const amt = Number(p[b.key] ?? 0)
                    return (
                      <td key={b.key} className="px-3 py-3 text-right">
                        {amt ? (
                          <button
                            type="button"
                            className="tabular-nums underline decoration-dotted underline-offset-2 hover:text-primary/80"
                            onClick={() => pushDocuments(p, b.key, b.label)}
                          >
                            {formatCurrency(amt)}
                          </button>
                        ) : (
                          formatCurrency(0)
                        )}
                      </td>
                    )
                  })}
                  <td className="px-4 py-3 text-right font-semibold">
                    {Number(p.total ?? 0) ? (
                      <button
                        type="button"
                        className="tabular-nums underline decoration-dotted underline-offset-2 hover:text-primary/80"
                        onClick={() => pushDocuments(p)}
                      >
                        {formatCurrency(Number(p.total ?? 0))}
                      </button>
                    ) : (
                      formatCurrency(0)
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot className="bg-muted font-semibold">
            <tr>
              <td className="px-4 py-3">Totals</td>
              {bucketLabels.map((b) => (
                <td key={b.key} className="px-3 py-3 text-right">
                  <ReportAmountCell
                    amount={Number(totals[b.key] ?? 0)}
                    row={agingBucketTotalRow(list, {
                      title: `${b.label} — all ${isAr ? 'customers' : 'vendors'}`,
                      entityType: isAr ? 'customers' : 'vendors',
                      field: b.key,
                      bucketKey: b.key,
                    })}
                    field={b.key}
                    scope={drillScope}
                  />
                </td>
              ))}
              <td className="px-4 py-3 text-right">
                <ReportAmountCell
                  amount={Number(totals.total ?? 0)}
                  row={agingBucketTotalRow(list, {
                    title: `All open ${isAr ? 'AR' : 'AP'}`,
                    entityType: isAr ? 'customers' : 'vendors',
                    field: 'total',
                  })}
                  field="total"
                  scope={drillScope}
                />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

export const EXTRA_FINANCIAL_REPORT_IDS: readonly ReportType[] = [
  'ar-aging',
  'ap-aging',
  'cash-flow',
  'expense-detail',
  'income-detail',
  'stations-financial-summary',
  'fuel-stations-pl-summary',
  'shop-hubs-pl-summary',
  'ponds-pl-summary',
  'entities-pl-summary',
  'entities-balance-sheet-summary',
  'entities-trial-balance-summary',
  'entities-financial-summary',
]
