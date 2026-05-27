'use client'

import type { ReactNode } from 'react'
import { formatCurrency } from '@/utils/formatting'

type ReportType =
  | 'ar-aging'
  | 'ap-aging'
  | 'cash-flow'
  | 'expense-detail'
  | 'income-detail'
  | 'stations-financial-summary'
  | 'entities-pl-summary'
  | 'entities-balance-sheet-summary'
  | 'entities-trial-balance-summary'
  | 'entities-financial-summary'

function entitySections(data: Record<string, unknown>) {
  return {
    byStation: (data.by_station as Record<string, unknown>[]) ?? [],
    byPond: (data.by_pond as Record<string, unknown>[]) ?? [],
    unscoped: data.unscoped as Record<string, unknown> | undefined,
    companyTotal: (data.company_total as Record<string, unknown>) ?? {},
    bsAsOf: String(data.balance_sheet_as_of ?? (data.period as { end_date?: string })?.end_date ?? ''),
  }
}

function entityPlTable(title: string, rows: Record<string, unknown>[]) {
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
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500">
                No entities with posted activity in this period.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={`pl-${String(r.entity_type)}-${String(r.entity_id ?? 'u')}`} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{String(r.entity_name ?? '')}</td>
                <td className="px-3 py-3 text-right">{formatCurrency(Number(r.income ?? 0))}</td>
                <td className="px-3 py-3 text-right">{formatCurrency(Number(r.cost_of_goods_sold ?? 0))}</td>
                <td className="px-3 py-3 text-right">{formatCurrency(Number(r.expenses ?? 0))}</td>
                <td className="px-3 py-3 text-right">{formatCurrency(Number(r.gross_profit ?? 0))}</td>
                <td className="px-3 py-3 text-right font-semibold">{formatCurrency(Number(r.net_income ?? 0))}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function entityBsTable(title: string, rows: Record<string, unknown>[], bsAsOf: string) {
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
                <td className="px-3 py-3 text-right">{formatCurrency(Number(r.total_assets ?? 0))}</td>
                <td className="px-3 py-3 text-right">{formatCurrency(Number(r.total_liabilities ?? 0))}</td>
                <td className="px-3 py-3 text-right">{formatCurrency(Number(r.total_equity ?? 0))}</td>
                <td className="px-3 py-3 text-right">{formatCurrency(Number(r.total_liabilities_and_equity ?? 0))}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function entityTbTable(title: string, rows: Record<string, unknown>[]) {
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
                <td className="px-3 py-3 text-right">{formatCurrency(Number(r.trial_balance_debit ?? 0))}</td>
                <td className="px-3 py-3 text-right">{formatCurrency(Number(r.trial_balance_credit ?? 0))}</td>
                <td className="px-3 py-3 text-center text-xs">{r.trial_balance_balanced ? 'Yes' : 'No'}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function renderEntitySectionTables(
  kind: 'pl' | 'bs' | 'tb',
  sections: ReturnType<typeof entitySections>,
) {
  const { byStation, byPond, unscoped, bsAsOf } = sections
  const table =
    kind === 'pl' ? entityPlTable : kind === 'bs' ? (t: string, r: Record<string, unknown>[]) => entityBsTable(t, r, bsAsOf) : entityTbTable
  const label =
    kind === 'pl' ? 'Profit & Loss' : kind === 'bs' ? 'Balance Sheet' : 'Trial Balance'
  return (
    <>
      {table(`${label} — stations`, byStation)}
      {byPond.length > 0 ? table(`${label} — ponds (GL tags)`, byPond) : null}
      {unscoped ? table(`${label} — head office / unassigned`, [unscoped]) : null}
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
      | { accounts?: { account_code?: string; account_name?: string; balance?: number }[]; total?: number }
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
            <span className="text-sm font-bold text-gray-700">{formatCurrency(Number(expenses?.total ?? 0))}</span>
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
                  <p className="text-sm font-semibold text-gray-900 ml-4">{formatCurrency(Number(account.balance ?? 0))}</p>
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
      | { accounts?: { account_code?: string; account_name?: string; balance?: number }[]; total?: number }
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
            <span className="text-sm font-bold text-gray-700">{formatCurrency(Number(income?.total ?? 0))}</span>
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
                  <p className="text-sm font-semibold text-gray-900 ml-4">{formatCurrency(Number(account.balance ?? 0))}</p>
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
                <td className="px-3 py-3 text-right">{formatCurrency(Number(r.net_income ?? 0))}</td>
                <td className="px-3 py-3 text-right text-green-800">
                  {formatCurrency(Number(r.customer_payments_received ?? 0))}
                </td>
                <td className="px-3 py-3 text-right text-red-700">
                  {formatCurrency(Number(r.vendor_payments_made ?? 0))}
                </td>
                <td className="px-3 py-3 text-right font-medium">
                  {formatCurrency(Number(r.net_change_in_cash ?? 0))}
                </td>
                <td className="px-3 py-3 text-right">{formatCurrency(Number(r.ending_cash ?? 0))}</td>
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
            <p className="text-xl font-bold mt-1">{formatCurrency(op.net_income)}</p>
          </div>
          <div className="bg-white border rounded-lg p-4 shadow-sm">
            <p className="text-xs text-gray-500 uppercase">Customer payments received</p>
            <p className="text-xl font-bold mt-1 text-green-800">{formatCurrency(op.customer_payments_received)}</p>
          </div>
          <div className="bg-white border rounded-lg p-4 shadow-sm">
            <p className="text-xs text-gray-500 uppercase">Vendor payments made</p>
            <p className="text-xl font-bold mt-1 text-red-700">{formatCurrency(op.vendor_payments_made)}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-gradient-to-br from-blue-50 to-white border border-blue-200 rounded-lg p-4">
            <p className="text-xs text-blue-700 uppercase">Beginning cash</p>
            <p className="text-2xl font-bold text-blue-900 mt-1">{formatCurrency(cash.beginning_cash)}</p>
          </div>
          <div className="bg-gradient-to-br from-slate-50 to-white border border-slate-200 rounded-lg p-4">
            <p className="text-xs text-slate-600 uppercase">Net change in cash</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{formatCurrency(cash.net_change_in_cash)}</p>
          </div>
          <div className="bg-gradient-to-br from-green-50 to-white border border-green-200 rounded-lg p-4">
            <p className="text-xs text-green-700 uppercase">Ending cash</p>
            <p className="text-2xl font-bold text-green-900 mt-1">{formatCurrency(cash.ending_cash)}</p>
          </div>
        </div>

        {showEntities ? (
          <div className="space-y-6">
            <p className="text-sm font-semibold text-slate-900">Cash flow by entity (all stations and ponds)</p>
            {entityTable('Stations (site-tagged GL + payments)', byStation, false)}
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
                    <td className="px-4 py-3 text-sm text-right">{formatCurrency(Number(b.beginning_balance ?? 0))}</td>
                    <td className="px-4 py-3 text-sm text-right text-green-800">{formatCurrency(Number(b.deposits ?? 0))}</td>
                    <td className="px-4 py-3 text-sm text-right text-red-700">{formatCurrency(Number(b.withdrawals ?? 0))}</td>
                    <td className="px-4 py-3 text-sm text-right font-medium">{formatCurrency(Number(b.ending_balance ?? 0))}</td>
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
      pl: 'Posted P&L for every station, pond, and head office slice. Clear the site filter.',
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
            {renderEntitySectionTables('pl', sections)}
            {renderEntitySectionTables('bs', sections)}
          </>
        ) : (
          renderEntitySectionTables(kind as 'pl' | 'bs' | 'tb', sections)
        )}
        <div className="rounded-lg border-2 border-slate-300 bg-slate-50 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Company total (all GL)</h3>
          {kind === 'pl' || isCombined ? (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 text-sm">
              <div>
                <p className="text-gray-500">Income</p>
                <p className="font-semibold">{formatCurrency(Number(co.income ?? 0))}</p>
              </div>
              <div>
                <p className="text-gray-500">COGS</p>
                <p className="font-semibold">{formatCurrency(Number(co.cost_of_goods_sold ?? 0))}</p>
              </div>
              <div>
                <p className="text-gray-500">Expenses</p>
                <p className="font-semibold">{formatCurrency(Number(co.expenses ?? 0))}</p>
              </div>
              <div>
                <p className="text-gray-500">Gross profit</p>
                <p className="font-semibold">{formatCurrency(Number(co.gross_profit ?? 0))}</p>
              </div>
              <div>
                <p className="text-gray-500">Net income</p>
                <p className="font-semibold">{formatCurrency(Number(co.net_income ?? 0))}</p>
              </div>
            </div>
          ) : null}
          {kind === 'bs' || isCombined ? (
            <div className={`mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm ${isCombined ? 'border-t border-slate-200 pt-4' : ''}`}>
              <div>
                <p className="text-gray-500">Assets</p>
                <p className="font-semibold">{formatCurrency(Number(co.total_assets ?? 0))}</p>
              </div>
              <div>
                <p className="text-gray-500">Liabilities</p>
                <p className="font-semibold">{formatCurrency(Number(co.total_liabilities ?? 0))}</p>
              </div>
              <div>
                <p className="text-gray-500">Equity</p>
                <p className="font-semibold">{formatCurrency(Number(co.total_equity ?? 0))}</p>
              </div>
              <div>
                <p className="text-gray-500">L + E</p>
                <p className="font-semibold">{formatCurrency(Number(co.total_liabilities_and_equity ?? 0))}</p>
              </div>
            </div>
          ) : kind === 'tb' ? (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              <div>
                <p className="text-gray-500">TB debits</p>
                <p className="font-semibold">{formatCurrency(Number(co.trial_balance_debit ?? 0))}</p>
              </div>
              <div>
                <p className="text-gray-500">TB credits</p>
                <p className="font-semibold">{formatCurrency(Number(co.trial_balance_credit ?? 0))}</p>
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

  if (reportType === 'stations-financial-summary') {
    const rows = (data.stations as Record<string, unknown>[]) ?? []
    const co = (data.company_total as Record<string, number>) ?? {}
    return (
      <div className="space-y-6">
        {periodFilter(
          'Posted GL P&L per station for the period. Use Income Statement with a site filter for account detail.',
        )}
        {typeof data.accounting_note === 'string' && (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{data.accounting_note}</p>
        )}
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Station</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Income</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">COGS</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Expenses</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Gross profit</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Net income</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-500">
                    No station-level P&L in this period. Post journals or clear the site filter.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={`st-pl-${String(r.station_id ?? '')}`} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{String(r.station_name ?? '')}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(Number(r.income ?? 0))}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(Number(r.cost_of_goods_sold ?? 0))}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(Number(r.expenses ?? 0))}</td>
                    <td className="px-4 py-3 text-right">{formatCurrency(Number(r.gross_profit ?? 0))}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatCurrency(Number(r.net_income ?? 0))}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot className="bg-gray-100 font-semibold">
              <tr>
                <td className="px-4 py-3">Company total (all GL lines)</td>
                <td className="px-4 py-3 text-right">{formatCurrency(Number(co.income ?? 0))}</td>
                <td className="px-4 py-3 text-right">{formatCurrency(Number(co.cost_of_goods_sold ?? 0))}</td>
                <td className="px-4 py-3 text-right">{formatCurrency(Number(co.expenses ?? 0))}</td>
                <td className="px-4 py-3 text-right">{formatCurrency(Number(co.gross_profit ?? 0))}</td>
                <td className="px-4 py-3 text-right">{formatCurrency(Number(co.net_income ?? 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    )
  }

  if (reportType === 'ar-aging' || reportType === 'ap-aging') {
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
    return (
      <div className="space-y-6">
        {periodFilter(`Open ${isAr ? 'invoices' : 'bills'} aged as of the end date.`)}
        {typeof data.accounting_note === 'string' && (
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">{data.accounting_note}</p>
        )}
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
                    <td className="px-4 py-3 font-medium text-gray-900">{String(p.display_name ?? '')}</td>
                    {bucketLabels.map((b) => (
                      <td key={b.key} className="px-3 py-3 text-right">
                        {formatCurrency(Number(p[b.key] ?? 0))}
                      </td>
                    ))}
                    <td className="px-4 py-3 text-right font-semibold">{formatCurrency(Number(p.total ?? 0))}</td>
                  </tr>
                ))
              )}
            </tbody>
            <tfoot className="bg-gray-100 font-semibold">
              <tr>
                <td className="px-4 py-3">Totals</td>
                {bucketLabels.map((b) => (
                  <td key={b.key} className="px-3 py-3 text-right">
                    {formatCurrency(Number(totals[b.key] ?? 0))}
                  </td>
                ))}
                <td className="px-4 py-3 text-right">{formatCurrency(Number(totals.total ?? 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    )
  }

  return null
}

export const EXTRA_FINANCIAL_REPORT_IDS: readonly ReportType[] = [
  'ar-aging',
  'ap-aging',
  'cash-flow',
  'expense-detail',
  'income-detail',
  'stations-financial-summary',
  'entities-pl-summary',
  'entities-balance-sheet-summary',
  'entities-trial-balance-summary',
  'entities-financial-summary',
]
