'use client'

import type { ReactNode } from 'react'
import { DrillAmount, glAccountDrill } from '@/components/reports/ReportDrillContext'
import { accountsTotalRow } from '@/components/reports/reportDrillAggregate'
import { AquaculturePlBottomLine } from '@/components/reports/AquaculturePlCategoryMatrices'

export type PlAccountRow = {
  account_id?: number | null
  account_code?: string
  account_name?: string
  balance?: string | number
  entity_name?: string | null
  entity_type?: string | null
  entity_id?: number | null
  pl_bucket?: string | null
  source?: string | null
  station_name?: string | null
  pond_name?: string | null
}

type DrillScope = {
  startDate?: string
  endDate?: string
  stationId?: number | null
  pondId?: number | null
  headOffice?: boolean
  reportType?: string
}

function activePlRows(rows: PlAccountRow[] | undefined): PlAccountRow[] {
  return (rows ?? []).filter((r) => Number(r.balance ?? 0) !== 0)
}

function entityLabel(row: PlAccountRow): string {
  return (
    (row.entity_name || row.pond_name || row.station_name || '').trim() ||
    'Unassigned'
  )
}

/** Group non-zero rows by entity for section heads. */
function groupByEntity(rows: PlAccountRow[]): { entity: string; rows: PlAccountRow[] }[] {
  const order: string[] = []
  const map = new Map<string, PlAccountRow[]>()
  for (const row of rows) {
    const key = entityLabel(row)
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key)!.push(row)
  }
  return order.map((entity) => ({ entity, rows: map.get(entity)! }))
}

function PlDetailSection({
  title,
  accent,
  rows,
  total,
  totalLabel,
  totalDrill,
  drillScope,
  Money,
  showEntityHeads,
}: {
  title: string
  accent: string
  rows: PlAccountRow[]
  total: number
  totalLabel: string
  totalDrill: Record<string, unknown>
  drillScope: DrillScope
  Money: (amount: unknown, row?: Record<string, unknown>, field?: string) => ReactNode
  showEntityHeads: boolean
}) {
  const groups = showEntityHeads ? groupByEntity(rows) : [{ entity: '', rows }]

  return (
    <div className={`rounded-lg border bg-white shadow-sm ${accent}`}>
      <div className="flex flex-col gap-2 border-b border-inherit p-4 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <div className="text-sm font-bold tabular-nums text-foreground">
          {Money(total, totalDrill, 'total')}
        </div>
      </div>
      <div className="divide-y divide-border">
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No {title.toLowerCase()} with activity in this period
          </div>
        ) : (
          groups.map(({ entity, rows: entityRows }) => (
            <div key={`${title}-${entity || 'all'}`}>
              {showEntityHeads && entity ? (
                <div className="bg-muted/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {entity}
                </div>
              ) : null}
              {entityRows.map((account, accIdx) => {
                const glDrill = glAccountDrill(account as Record<string, unknown>, drillScope)
                return (
                  <div
                    key={`${title}-${entity}-${accIdx}-${account.account_code ?? 'acct'}`}
                    className="flex justify-between px-4 py-3 transition-colors hover:bg-card/80"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-foreground">
                        {account.account_name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {account.account_code}
                        {!showEntityHeads && entityLabel(account) !== 'Unassigned' ? (
                          <span className="ml-2 text-muted-foreground/80">· {entityLabel(account)}</span>
                        ) : null}
                        {account.pl_bucket === 'cost_of_goods_sold' ? (
                          <span className="ml-2 text-warning-foreground">· COGS</span>
                        ) : null}
                      </p>
                    </div>
                    <div className="ml-4 whitespace-nowrap text-sm font-semibold tabular-nums text-foreground">
                      <DrillAmount amount={account.balance} drill={glDrill} />
                    </div>
                  </div>
                )
              })}
            </div>
          ))
        )}
        <div className="flex items-center justify-between border-t border-border bg-muted/50 px-4 py-3">
          <span className="text-sm font-semibold text-foreground">{totalLabel}</span>
          <span className="text-sm font-bold tabular-nums text-foreground">
            {Money(total, totalDrill, 'total')}
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * Full P&L layout: 3 summary cards, then income rows → total income →
 * expense rows (COGS + opex) → total expense → net income.
 * Only non-zero COA / category rows are shown; entity heads when multi-entity.
 */
export function IncomeStatementPlPanel({
  data,
  drillScope,
  Money,
  banner,
}: {
  data: Record<string, unknown>
  drillScope: DrillScope
  Money: (amount: unknown, row?: Record<string, unknown>, field?: string) => ReactNode
  banner?: ReactNode
}) {
  const incomeBlock = data.income as { accounts?: PlAccountRow[]; total?: string | number } | undefined
  const cogsBlock = data.cost_of_goods_sold as
    | { accounts?: PlAccountRow[]; total?: string | number }
    | undefined
  const expenseBlock = data.expenses as
    | { accounts?: PlAccountRow[]; total?: string | number }
    | undefined

  const incomeRows = activePlRows(incomeBlock?.accounts)
  const cogsRows = activePlRows(cogsBlock?.accounts).map((r) => ({
    ...r,
    pl_bucket: r.pl_bucket || 'cost_of_goods_sold',
  }))
  const opexRows = activePlRows(expenseBlock?.accounts).map((r) => ({
    ...r,
    pl_bucket: r.pl_bucket || 'expense',
  }))
  const expenseRows = [...cogsRows, ...opexRows].sort((a, b) => {
    const ea = entityLabel(a)
    const eb = entityLabel(b)
    if (ea !== eb) return ea.localeCompare(eb)
    return String(a.account_code || '').localeCompare(String(b.account_code || ''))
  })

  const incomeTotal = Number(incomeBlock?.total ?? 0)
  const cogsTotal = Number(cogsBlock?.total ?? 0)
  const opexTotal = Number(expenseBlock?.total ?? 0)
  const totalExpenses = Number(
    data.total_expenses ?? cogsTotal + opexTotal,
  )
  const netIncome = Number(data.net_income ?? incomeTotal - totalExpenses)

  const plIncomeDrill = accountsTotalRow(incomeRows as Record<string, unknown>[], 'Income')
  const plExpenseDrill = accountsTotalRow(expenseRows as Record<string, unknown>[], 'Expenses')
  const plAllDrill = accountsTotalRow(
    [...incomeRows, ...expenseRows] as Record<string, unknown>[],
    'Profit & Loss',
  )

  const entityNames = new Set(
    [...incomeRows, ...expenseRows].map(entityLabel).filter((n) => n && n !== 'Unassigned'),
  )
  const showEntityHeads = entityNames.size > 1

  return (
    <div className="space-y-6">
      {banner}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-emerald-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
            Total income
          </p>
          <div className="mt-1 text-xl font-bold tabular-nums text-emerald-900">
            {Money(incomeTotal, plIncomeDrill, 'total')}
          </div>
        </div>
        <div className="rounded-lg border border-rose-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-800">
            Total expense
          </p>
          <div className="mt-1 text-xl font-bold tabular-nums text-rose-900">
            {Money(totalExpenses, plExpenseDrill, 'total')}
          </div>
        </div>
        <div className="rounded-lg border border-blue-300 bg-blue-50 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Net income</p>
          <div
            className={`mt-1 text-xl font-bold tabular-nums ${
              netIncome >= 0 ? 'text-blue-900' : 'text-destructive'
            }`}
          >
            {Money(netIncome, plAllDrill, 'total')}
          </div>
        </div>
      </div>

      {data.period_matches_cumulative_change === false ? (
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground">
          <p className="font-semibold">Period net income vs cumulative P&amp;L change</p>
          <p className="mt-1">
            This period&apos;s net differs from the change in cumulative P&amp;L. That usually means an
            opening balance on an income, COGS, or expense account, or activity dated outside the
            selected range.
          </p>
        </div>
      ) : null}

      <div className="space-y-6">
        <PlDetailSection
          title="Income"
          accent="border-emerald-200 bg-emerald-50/50"
          rows={incomeRows}
          total={incomeTotal}
          totalLabel="Total income"
          totalDrill={plIncomeDrill}
          drillScope={drillScope}
          Money={Money}
          showEntityHeads={showEntityHeads}
        />
        <PlDetailSection
          title="Expenses"
          accent="border-border bg-muted/40"
          rows={expenseRows}
          total={totalExpenses}
          totalLabel="Total expense"
          totalDrill={plExpenseDrill}
          drillScope={drillScope}
          Money={Money}
          showEntityHeads={showEntityHeads}
        />
        <div
          className={`flex items-center justify-between rounded-lg border-2 px-4 py-4 shadow-sm ${
            netIncome >= 0 ? 'border-blue-300 bg-blue-50' : 'border-destructive/30 bg-destructive/5'
          }`}
        >
          <span
            className={`text-base font-bold ${netIncome >= 0 ? 'text-primary' : 'text-destructive'}`}
          >
            Net income
          </span>
          <span
            className={`text-lg font-bold tabular-nums ${
              netIncome >= 0 ? 'text-primary' : 'text-destructive'
            }`}
          >
            {Money(netIncome, plAllDrill, 'total')}
          </span>
        </div>
      </div>

      <AquaculturePlBottomLine
        income={incomeTotal}
        expenses={totalExpenses}
        netProfit={netIncome}
      />
    </div>
  )
}
