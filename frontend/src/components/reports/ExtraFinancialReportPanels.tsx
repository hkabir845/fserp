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
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <h3 className="bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-900 border-b">{title}</h3>
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entity</th>
            <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Income</th>
            <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">COGS</th>
            <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Expenses</th>
            <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Gross</th>
            <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Net income</th>
            {onViewDetail ? (
              <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Detail</th>
            ) : null}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-gray-500">
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
                <tr key={`pl-${String(r.entity_type)}-${String(r.entity_id ?? 'u')}`} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <div>{String(r.entity_name ?? '')}</div>
                    {entityKind === 'station' && r.business_kind_label ? (
                      <div className="mt-0.5 text-xs font-normal text-slate-500">{String(r.business_kind_label)}</div>
                    ) : null}
                    {entityKind === 'station' && r.combined_shop_gross_profit != null ? (
                      <div className="mt-1 text-xs text-indigo-700">
                        Shop total (incl. sales to ponds): gross{' '}
                        {formatCurrency(Number(r.combined_shop_gross_profit ?? 0))}
                      </div>
                    ) : null}
                    {entityKind === 'pond' && r.pond_open_ar_bdt != null ? (
                      <div className="mt-1 text-xs text-slate-500">
                        AR {formatCurrency(Number(r.pond_open_ar_bdt ?? 0))} · AP{' '}
                        {formatCurrency(Number(r.pond_open_ap_bdt ?? 0))} · Stock{' '}
                        {formatCurrency(Number(r.pond_warehouse_inventory_value_bdt ?? 0))}
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
                        className="text-sm font-medium text-blue-700 hover:text-blue-900 underline"
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
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <h3 className="bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-900 border-b">
        {title}
        {bsAsOf ? <span className="ml-2 font-normal text-gray-500">(as of {bsAsOf})</span> : null}
      </h3>
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entity</th>
            <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Assets</th>
            <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Liabilities</th>
            <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Equity</th>
            <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">L + E</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500">
                No balance sheet balances for entities in this period.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={`bs-${String(r.entity_type)}-${String(r.entity_id ?? 'u')}`} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{String(r.entity_name ?? '')}</td>
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
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <h3 className="bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-900 border-b">{title}</h3>
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entity</th>
            <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Debits</th>
            <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Credits</th>
            <th className="px-3 py-3 text-center text-xs font-medium text-gray-500 uppercase">Balanced</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-500">
                No trial balance activity for entities in this period.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={`tb-${String(r.entity_type)}-${String(r.entity_id ?? 'u')}`} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{String(r.entity_name ?? '')}</td>
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
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h4 className="text-sm font-semibold text-slate-900">{title}</h4>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-sm">
        <div>
          <p className="text-gray-500">Income</p>
          <p className="font-semibold">
            <ReportAmountCell amount={Number(totals.income ?? 0)} row={totals} field="income" scope={drillScope} />
          </p>
        </div>
        <div>
          <p className="text-gray-500">COGS</p>
          <p className="font-semibold">
            <ReportAmountCell amount={Number(totals.cost_of_goods_sold ?? 0)} row={totals} field="cost_of_goods_sold" scope={drillScope} />
          </p>
        </div>
        <div>
          <p className="text-gray-500">Expenses</p>
          <p className="font-semibold">
            <ReportAmountCell amount={Number(totals.expenses ?? 0)} row={totals} field="expenses" scope={drillScope} />
          </p>
        </div>
        <div>
          <p className="text-gray-500">Gross profit</p>
          <p className="font-semibold">
            <ReportAmountCell amount={Number(totals.gross_profit ?? 0)} row={totals} field="gross_profit" scope={drillScope} />
          </p>
        </div>
        <div>
          <p className="text-gray-500">Net income</p>
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
  },
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
  const fuelStations = byFuelStation.length ? byFuelStation : byStation.filter((r) => r.business_kind !== 'shop_hub')
  const shopHubs = byShopHub.length ? byShopHub : byStation.filter((r) => r.business_kind === 'shop_hub')
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

  return (
    <>
      {renderSection(
        `${label} — fuel filling stations`,
        fuelStations,
        'station',
        fuelStationsTotal,
        'Total — all fuel filling stations',
      )}
      {renderSection(
        `${label} — shop hubs (no fuel)`,
        shopHubs,
        'station',
        shopHubsTotal,
        'Total — all shop hubs (no fuel)',
      )}
      {renderSection(
        `${label} — ponds (aquaculture, GL-tagged)`,
        byPond,
        'pond',
        pondsTotal,
        'Total — all ponds',
      )}
      {unscoped ? renderSection(`${label} — head office / unassigned`, [unscoped]) : null}
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
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{data.accounting_note}</p>
        )}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
          <div className="p-4 border-b bg-gray-50 flex justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Expenses</h3>
            <span className="text-sm font-bold text-gray-700">
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
          <div className="divide-y divide-gray-200">
            {accounts.length > 0 ? (
              accounts.map((account, accIdx) => (
                <div
                  key={`exp-${accIdx}-${account.account_code ?? 'acct'}`}
                  className="px-4 py-3 flex justify-between hover:bg-gray-50"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{account.account_name}</p>
                    <p className="text-xs text-gray-500">{account.account_code}</p>
                  </div>
                  <p className="text-sm font-semibold text-gray-900 ml-4">
                    <DrillAmount
                      amount={Number(account.balance ?? 0)}
                      drill={glAccountDrill(account as { account_id?: number; account_code?: string; account_name?: string }, ctx.drillScope)}
                    />
                  </p>
                </div>
              ))
            ) : (
              <div className="px-4 py-8 text-center text-gray-400 text-sm">No expense activity in this period</div>
            )}
          </div>
        </div>
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
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{data.accounting_note}</p>
        )}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
          <div className="p-4 border-b bg-gray-50 flex justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Income</h3>
            <span className="text-sm font-bold text-gray-700">
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
          <div className="divide-y divide-gray-200">
            {accounts.length > 0 ? (
              accounts.map((account, accIdx) => (
                <div
                  key={`inc-${accIdx}-${account.account_code ?? 'acct'}`}
                  className="px-4 py-3 flex justify-between hover:bg-gray-50"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{account.account_name}</p>
                    <p className="text-xs text-gray-500">{account.account_code}</p>
                  </div>
                  <p className="text-sm font-semibold text-gray-900 ml-4">
                    <DrillAmount
                      amount={Number(account.balance ?? 0)}
                      drill={glAccountDrill(account as { account_id?: number; account_code?: string; account_name?: string }, ctx.drillScope)}
                    />
                  </p>
                </div>
              ))
            ) : (
              <div className="px-4 py-8 text-center text-gray-400 text-sm">No income activity in this period</div>
            )}
          </div>
        </div>
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
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <h3 className="bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-900 border-b">{title}</h3>
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entity</th>
              <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Net income</th>
              <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase whitespace-nowrap">
                {pondCols ? 'Pond sales' : 'Customer rcpts'}
              </th>
              <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase whitespace-nowrap">Vendor pmt</th>
              <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Net cash change</th>
              <th className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase">Ending cash</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {rows.map((r) => (
              <tr key={`${String(r.entity_type)}-${String(r.entity_id ?? 'u')}`} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{String(r.entity_name ?? '')}</td>
                <td className="px-3 py-3 text-right">
                  <ReportAmountCell amount={Number(r.net_income ?? 0)} row={r} field="net_income" scope={ctx.drillScope} />
                </td>
                <td className="px-3 py-3 text-right text-green-800">
                  <ReportAmountCell amount={Number(r.customer_payments_received ?? 0)} row={r} field="customer_payments_received" scope={ctx.drillScope} />
                </td>
                <td className="px-3 py-3 text-right text-red-700">
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
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{data.accounting_note}</p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white border rounded-lg p-4 shadow-sm">
            <p className="text-xs text-gray-500 uppercase">Net income (P&L)</p>
            <p className="text-xl font-bold mt-1"><ReportAmountCell amount={Number(op.net_income ?? 0)} row={op} field="net_income" scope={ctx.drillScope ?? {}} /></p>
          </div>
          <div className="bg-white border rounded-lg p-4 shadow-sm">
            <p className="text-xs text-gray-500 uppercase">Customer payments received</p>
            <p className="text-xl font-bold mt-1 text-green-800"><ReportAmountCell amount={Number(op.customer_payments_received ?? 0)} row={op} field="customer_payments_received" scope={ctx.drillScope ?? {}} /></p>
          </div>
          <div className="bg-white border rounded-lg p-4 shadow-sm">
            <p className="text-xs text-gray-500 uppercase">Vendor payments made</p>
            <p className="text-xl font-bold mt-1 text-red-700"><ReportAmountCell amount={Number(op.vendor_payments_made ?? 0)} row={op} field="vendor_payments_made" scope={ctx.drillScope ?? {}} /></p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-blue-50 to-white border border-blue-200 rounded-lg p-4">
            <p className="text-xs text-blue-700 uppercase">Beginning cash</p>
            <p className="text-2xl font-bold text-blue-900 mt-1"><ReportAmountCell amount={Number(cash.beginning_cash ?? 0)} row={cash} field="beginning_cash" scope={ctx.drillScope ?? {}} /></p>
          </div>
          <div className="bg-gradient-to-br from-slate-50 to-white border border-slate-200 rounded-lg p-4">
            <p className="text-xs text-slate-600 uppercase">Net change in cash</p>
            <p className="text-2xl font-bold text-slate-900 mt-1"><ReportAmountCell amount={Number(cash.net_change_in_cash ?? 0)} row={cash} field="net_change_in_cash" scope={ctx.drillScope ?? {}} /></p>
          </div>
          <div className="bg-gradient-to-br from-green-50 to-white border border-green-200 rounded-lg p-4">
            <p className="text-xs text-green-700 uppercase">Ending cash</p>
            <p className="text-2xl font-bold text-green-900 mt-1"><ReportAmountCell amount={Number(cash.ending_cash ?? 0)} row={cash} field="ending_cash" scope={ctx.drillScope ?? {}} /></p>
          </div>
        </div>

        {showEntities ? (
          <div className="space-y-6">
            <p className="text-sm font-semibold text-slate-900">Cash flow by entity (each station, shop hub, and pond)</p>
            {entityTable('Fuel filling stations', byFuel, false)}
            {entityTable('Shop hubs (no fuel)', byShop, false)}
            {byPond.length > 0 ? entityTable('Ponds (pond-tagged bank GL + registered sales)', byPond, true) : null}
            {unscoped ? entityTable('Head office / unassigned', [unscoped], false) : null}
          </div>
        ) : null}

        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <h3 className="bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-900 border-b">Bank accounts (company)</h3>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Bank account</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Beginning</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Deposits</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Withdrawals</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Ending</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {banks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-500">
                    No bank_account chart rows with activity in this period.
                  </td>
                </tr>
              ) : (
                banks.map((b, i) => (
                  <tr key={`bank-${i}-${String(b.account_code ?? '')}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm">
                      <div className="font-medium text-gray-900">{String(b.account_name ?? '')}</div>
                      <div className="text-xs text-gray-500">{String(b.account_code ?? '')}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-right">
                      <ReportAmountCell amount={Number(b.beginning_balance ?? 0)} row={b} field="beginning_balance" scope={ctx.drillScope} />
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-green-800">
                      <ReportAmountCell amount={Number(b.deposits ?? 0)} row={b} field="deposits" scope={ctx.drillScope} />
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-red-700">
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
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{data.accounting_note}</p>
        )}
        {isCombined ? (
          <>
            {renderEntitySectionTables('pl', sections, ctx.onViewEntityPl, ctx.drillScope)}
            {renderEntitySectionTables('bs', sections, ctx.onViewEntityPl, ctx.drillScope)}
          </>
        ) : (
          renderEntitySectionTables(kind as 'pl' | 'bs' | 'tb', sections, ctx.onViewEntityPl, ctx.drillScope)
        )}
        {kind === 'pl' && data.segment_totals ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {segmentPlTotalsCard('Total — fuel filling stations', (data.segment_totals as Record<string, unknown>).fuel_stations as Record<string, unknown>, ctx.drillScope)}
            {segmentPlTotalsCard('Total — shop hubs (no fuel)', (data.segment_totals as Record<string, unknown>).shop_hubs as Record<string, unknown>, ctx.drillScope)}
            {segmentPlTotalsCard('Total — all stations', (data.segment_totals as Record<string, unknown>).all_stations as Record<string, unknown>, ctx.drillScope)}
            {segmentPlTotalsCard('Total — all ponds', (data.segment_totals as Record<string, unknown>).ponds as Record<string, unknown>, ctx.drillScope)}
          </div>
        ) : null}
        <div className="rounded-lg border-2 border-slate-300 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Company total (all GL)</h3>
          {kind === 'pl' || isCombined ? (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-sm">
              <div>
                <p className="text-gray-500">Income</p>
                <p className="font-semibold"><ReportAmountCell amount={Number(co.income ?? 0)} row={{ _drill: { income: { kind: 'scoped-pl', label: 'Company income' } } }} field="income" scope={ctx.drillScope ?? {}} /></p>
              </div>
              <div>
                <p className="text-gray-500">COGS</p>
                <p className="font-semibold"><ReportAmountCell amount={Number(co.cost_of_goods_sold ?? 0)} row={{ _drill: { cost_of_goods_sold: { kind: 'scoped-pl', label: 'Company COGS' } } }} field="cost_of_goods_sold" scope={ctx.drillScope ?? {}} /></p>
              </div>
              <div>
                <p className="text-gray-500">Expenses</p>
                <p className="font-semibold"><ReportAmountCell amount={Number(co.expenses ?? 0)} row={{ _drill: { expenses: { kind: 'scoped-pl', label: 'Company expenses' } } }} field="expenses" scope={ctx.drillScope ?? {}} /></p>
              </div>
              <div>
                <p className="text-gray-500">Gross profit</p>
                <p className="font-semibold"><ReportAmountCell amount={Number(co.gross_profit ?? 0)} row={{ _drill: { gross_profit: { kind: 'scoped-pl', label: 'Company gross profit' } } }} field="gross_profit" scope={ctx.drillScope ?? {}} /></p>
              </div>
              <div>
                <p className="text-gray-500">Net income</p>
                <p className="font-semibold"><ReportAmountCell amount={Number(co.net_income ?? 0)} row={{ _drill: { net_income: { kind: 'scoped-pl', label: 'Company net income' } } }} field="net_income" scope={ctx.drillScope ?? {}} /></p>
              </div>
            </div>
          ) : null}
          {kind === 'bs' || isCombined ? (
            <div className={`mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm ${isCombined ? 'border-t border-slate-200 pt-4' : ''}`}>
              <div>
                <p className="text-gray-500">Assets</p>
                <p className="font-semibold"><ReportAmountCell amount={Number(co.total_assets ?? 0)} row={{ _drill: { total_assets: { kind: 'scoped-pl', label: 'Company assets' } } }} field="total_assets" scope={ctx.drillScope ?? {}} /></p>
              </div>
              <div>
                <p className="text-gray-500">Liabilities</p>
                <p className="font-semibold"><ReportAmountCell amount={Number(co.total_liabilities ?? 0)} row={{ _drill: { total_liabilities: { kind: 'scoped-pl', label: 'Company liabilities' } } }} field="total_liabilities" scope={ctx.drillScope ?? {}} /></p>
              </div>
              <div>
                <p className="text-gray-500">Equity</p>
                <p className="font-semibold"><ReportAmountCell amount={Number(co.total_equity ?? 0)} row={{ _drill: { total_equity: { kind: 'scoped-pl', label: 'Company equity' } } }} field="total_equity" scope={ctx.drillScope ?? {}} /></p>
              </div>
              <div>
                <p className="text-gray-500">L + E</p>
                <p className="font-semibold"><ReportAmountCell amount={Number(co.total_liabilities_and_equity ?? 0)} row={{ _drill: { total_liabilities_and_equity: { kind: 'scoped-pl', label: 'Company L + E' } } }} field="total_liabilities_and_equity" scope={ctx.drillScope ?? {}} /></p>
              </div>
            </div>
          ) : kind === 'tb' ? (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-gray-500">TB debits</p>
                <p className="font-semibold"><ReportAmountCell amount={Number(co.trial_balance_debit ?? 0)} row={{ _drill: { trial_balance_debit: { kind: 'scoped-pl', label: 'Company TB debits' } } }} field="trial_balance_debit" scope={ctx.drillScope ?? {}} /></p>
              </div>
              <div>
                <p className="text-gray-500">TB credits</p>
                <p className="font-semibold"><ReportAmountCell amount={Number(co.trial_balance_credit ?? 0)} row={{ _drill: { trial_balance_credit: { kind: 'scoped-pl', label: 'Company TB credits' } } }} field="trial_balance_credit" scope={ctx.drillScope ?? {}} /></p>
              </div>
              <div>
                <p className="text-gray-500">Balanced</p>
                <p className="font-semibold">{co.trial_balance_balanced ? 'Yes' : 'No'}</p>
              </div>
            </div>
          ) : null}
        </div>
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
    const rows = (isPond
      ? (data.ponds as Record<string, unknown>[])
      : isFuelOnly
        ? (data.fuel_stations as Record<string, unknown>[])
        : isShopOnly
          ? (data.shop_hubs as Record<string, unknown>[])
          : (data.stations as Record<string, unknown>[])) ?? []
    const fuelRows = (data.fuel_stations as Record<string, unknown>[]) ?? []
    const shopRows = (data.shop_hubs as Record<string, unknown>[]) ?? []
    const segmentTotals = (data.segment_totals as Record<string, Record<string, unknown>>) ?? {}
    const entityTotal = (isPond
      ? data.ponds_total ?? data.category_total
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
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{data.accounting_note}</p>
        )}
        {isPond ? (
          entityPlTable('Ponds', rows, 'pond', ctx.onViewEntityPl, ctx.drillScope)
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
        {segmentPlTotalsCard(
          isPond
            ? 'Total — all ponds'
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
        <div className="rounded-lg border-2 border-slate-300 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Company total (all GL)</h3>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-sm">
            <div>
              <p className="text-gray-500">Income</p>
              <p className="font-semibold"><ReportAmountCell amount={Number(co.income ?? 0)} row={{ _drill: { income: { kind: 'scoped-pl', label: 'Company income' } } }} field="income" scope={ctx.drillScope ?? {}} /></p>
            </div>
            <div>
              <p className="text-gray-500">COGS</p>
              <p className="font-semibold"><ReportAmountCell amount={Number(co.cost_of_goods_sold ?? 0)} row={{ _drill: { cost_of_goods_sold: { kind: 'scoped-pl', label: 'Company COGS' } } }} field="cost_of_goods_sold" scope={ctx.drillScope ?? {}} /></p>
            </div>
            <div>
              <p className="text-gray-500">Expenses</p>
              <p className="font-semibold"><ReportAmountCell amount={Number(co.expenses ?? 0)} row={{ _drill: { expenses: { kind: 'scoped-pl', label: 'Company expenses' } } }} field="expenses" scope={ctx.drillScope ?? {}} /></p>
            </div>
            <div>
              <p className="text-gray-500">Gross profit</p>
              <p className="font-semibold"><ReportAmountCell amount={Number(co.gross_profit ?? 0)} row={{ _drill: { gross_profit: { kind: 'scoped-pl', label: 'Company gross profit' } } }} field="gross_profit" scope={ctx.drillScope ?? {}} /></p>
            </div>
            <div>
              <p className="text-gray-500">Net income</p>
              <p className="font-semibold"><ReportAmountCell amount={Number(co.net_income ?? 0)} row={{ _drill: { net_income: { kind: 'scoped-pl', label: 'Company net income' } } }} field="net_income" scope={ctx.drillScope ?? {}} /></p>
            </div>
          </div>
        </div>
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
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{data.accounting_note}</p>
      )}
      <p className="text-xs text-gray-500">
        Click an amount to see underlying {isAr ? 'invoices' : 'bills'}. Use Back or Close in the detail window to return to this report.
      </p>
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                {isAr ? 'Customer' : 'Vendor'}
              </th>
              {bucketLabels.map((b) => (
                <th
                  key={b.key}
                  className="px-3 py-3 text-right text-xs font-medium text-gray-500 uppercase whitespace-nowrap"
                >
                  {b.label}
                </th>
              ))}
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {list.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-gray-500">
                  No open {isAr ? 'receivables' : 'payables'} in aging buckets.
                </td>
              </tr>
            ) : (
              list.map((p, idx) => (
                <tr key={`${isAr ? 'ar' : 'ap'}-${idx}-${String(p.display_name ?? '')}`} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">
                    <button
                      type="button"
                      className="text-left hover:text-blue-800 hover:underline"
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
                            className="tabular-nums underline decoration-dotted underline-offset-2 hover:text-blue-800"
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
                        className="tabular-nums underline decoration-dotted underline-offset-2 hover:text-blue-800"
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
          <tfoot className="bg-gray-100 font-semibold">
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
