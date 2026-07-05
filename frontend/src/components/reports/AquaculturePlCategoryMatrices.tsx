'use client'

import { ReportAmountCell } from '@/components/reports/ReportAmountCell'

function MoneyBdt(amount: unknown) {
  return <ReportAmountCell amount={Number(amount ?? 0)} currency="BDT" plain />
}

export interface PlCategoryRow {
  category: string
  label: string
  amount: string
}

export interface PlPondCategoryGroup {
  pond_id: number
  pond_name: string
  categories: PlCategoryRow[]
}

export interface PlColumnDef {
  code: string
  label: string
}

interface AquaculturePlCategoryMatricesProps {
  incomeByPond?: PlPondCategoryGroup[]
  incomeByCategory?: PlCategoryRow[]
  expensesByPond?: PlPondCategoryGroup[]
  expensesByCategory?: PlCategoryRow[]
  incomeColumns?: PlColumnDef[]
  expenseColumns?: PlColumnDef[]
  showFullCatalog?: boolean
  pondScopeLabel?: string
  combinedMode?: boolean
  rowTotalsByPond?: {
    pond_id: number
    income_total: string
    expense_total: string
    net_profit: string
  }[]
  grandTotals?: {
    total_income: string
    total_costs_and_expenses: string
    net_profit: string
  }
  formulaNote?: string
}

function amountMap(categories: PlCategoryRow[] | undefined): Map<string, string> {
  const m = new Map<string, string>()
  for (const c of categories ?? []) {
    m.set(c.category, c.amount)
  }
  return m
}

function columnKeysFromSources(
  groups: PlPondCategoryGroup[],
  fallback: PlCategoryRow[],
  explicitColumns?: PlColumnDef[],
  showFullCatalog?: boolean,
): string[] {
  if (showFullCatalog && explicitColumns?.length) {
    return explicitColumns.map((c) => c.code)
  }
  if (fallback.length > 0) {
    return fallback.map((c) => c.category)
  }
  const seen = new Set<string>()
  const keys: string[] = []
  for (const g of groups) {
    for (const c of g.categories ?? []) {
      if (!seen.has(c.category)) {
        seen.add(c.category)
        keys.push(c.category)
      }
    }
  }
  return keys
}

function labelForKey(
  groups: PlPondCategoryGroup[],
  fallback: PlCategoryRow[],
  explicitColumns: PlColumnDef[] | undefined,
  key: string,
): string {
  const fromExplicit = explicitColumns?.find((c) => c.code === key)
  if (fromExplicit?.label) return fromExplicit.label
  const fromFallback = fallback.find((c) => c.category === key)
  if (fromFallback?.label) return fromFallback.label
  for (const g of groups) {
    const hit = (g.categories ?? []).find((c) => c.category === key)
    if (hit?.label) return hit.label
  }
  return key.replace(/_/g, ' ')
}

function CategoryMatrixTable({
  title,
  description,
  groups,
  scopeTotals,
  columnKeys,
  getLabel,
}: {
  title: string
  description: string
  groups: PlPondCategoryGroup[]
  scopeTotals: PlCategoryRow[]
  columnKeys: string[]
  getLabel: (key: string) => string
}) {
  if (columnKeys.length === 0) {
    return (
      <div>
        <h4 className="font-semibold text-foreground mb-1">{title}</h4>
        <p className="text-sm text-muted-foreground">No {title.toLowerCase()} in this period.</p>
      </div>
    )
  }

  const totalsMap = amountMap(scopeTotals)
  const colTotal = (key: string) =>
    groups.reduce((s, g) => s + Number(amountMap(g.categories).get(key) || 0), 0)

  return (
    <div>
      <h4 className="font-semibold text-foreground mb-1">{title}</h4>
      <p className="mb-2 text-xs text-muted-foreground">{description}</p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-left font-medium text-muted-foreground">
                Pond
              </th>
              {columnKeys.map((key) => (
                <th key={key} className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap">
                  {getLabel(key)}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-medium text-foreground whitespace-nowrap">Row total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70 bg-white">
            {groups.map((g) => {
              const rowMap = amountMap(g.categories)
              const rowSum = columnKeys.reduce((s, k) => s + Number(rowMap.get(k) || 0), 0)
              return (
                <tr key={g.pond_id}>
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-foreground">
                    {g.pond_name}
                  </td>
                  {columnKeys.map((key) => {
                    const amt = rowMap.get(key) || '0'
                    const n = Number(amt)
                    return (
                      <td
                        key={`${g.pond_id}-${key}`}
                        className={`px-3 py-2 text-right tabular-nums ${n === 0 ? 'text-muted-foreground/50' : ''}`}
                      >
                        {MoneyBdt(amt)}
                      </td>
                    )
                  })}
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{MoneyBdt(String(rowSum))}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-muted">
            <tr>
              <td className="sticky left-0 z-10 bg-muted px-3 py-2 font-bold text-foreground">Column total</td>
              {columnKeys.map((key) => {
                const scopeAmt = totalsMap.get(key)
                const sum = scopeAmt != null ? Number(scopeAmt) : colTotal(key)
                return (
                  <td key={`tot-${key}`} className="px-3 py-2 text-right font-bold tabular-nums text-foreground">
                    {MoneyBdt(String(sum))}
                  </td>
                )
              })}
              <td className="px-3 py-2 text-right font-bold tabular-nums text-foreground">
                {MoneyBdt(
                  String(
                    columnKeys.reduce((s, k) => {
                      const scopeAmt = totalsMap.get(k)
                      return s + (scopeAmt != null ? Number(scopeAmt) : colTotal(k))
                    }, 0),
                  ),
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function sumExpenseColumns(
  expMap: Map<string, string>,
  expenseKeys: string[],
): number {
  return expenseKeys.reduce((s, k) => {
    const n = Number(expMap.get(k) || 0)
    if (k === 'fish_transfer_cost_out') return s - n
    return s + n
  }, 0)
}

function displayExpenseAmount(code: string, amt: string): string {
  if (code === 'fish_transfer_cost_out') {
    const n = Number(amt || 0)
    if (n === 0) return '0'
    return String(-Math.abs(n))
  }
  return amt
}

function CombinedIncomeExpenseMatrix({
  incomeByPond,
  incomeByCategory,
  expensesByPond,
  expensesByCategory,
  incomeColumns,
  expenseColumns,
  showFullCatalog,
  pondScopeLabel,
  rowTotalsByPond,
  grandTotals,
  formulaNote,
}: AquaculturePlCategoryMatricesProps) {
  const useFullCatalog = showFullCatalog !== false && Boolean(incomeColumns?.length || expenseColumns?.length)
  const incomeKeys = columnKeysFromSources(
    incomeByPond ?? [],
    incomeByCategory ?? [],
    incomeColumns,
    useFullCatalog,
  )
  const expenseKeys = columnKeysFromSources(
    expensesByPond ?? [],
    expensesByCategory ?? [],
    expenseColumns,
    useFullCatalog,
  )

  const pondIds = new Set<number>()
  for (const g of incomeByPond ?? []) pondIds.add(g.pond_id)
  for (const g of expensesByPond ?? []) pondIds.add(g.pond_id)
  const pondOrder: { id: number; name: string }[] = []
  const seen = new Set<number>()
  for (const g of [...(incomeByPond ?? []), ...(expensesByPond ?? [])]) {
    if (!seen.has(g.pond_id)) {
      seen.add(g.pond_id)
      pondOrder.push({ id: g.pond_id, name: g.pond_name })
    }
  }

  const incomeGroupMap = new Map((incomeByPond ?? []).map((g) => [g.pond_id, g]))
  const expenseGroupMap = new Map((expensesByPond ?? []).map((g) => [g.pond_id, g]))
  const incomeTotalsMap = amountMap(incomeByCategory)
  const expenseTotalsMap = amountMap(expensesByCategory)
  const rowTotalsMap = new Map((rowTotalsByPond ?? []).map((p) => [p.pond_id, p]))

  const incomeColTotal = (key: string) =>
    (incomeByPond ?? []).reduce((s, g) => s + Number(amountMap(g.categories).get(key) || 0), 0)
  const expenseColTotal = (key: string) => {
    if (key === 'fish_transfer_cost_out') {
      return -(expensesByPond ?? []).reduce(
        (s, g) => s + Number(amountMap(g.categories).get(key) || 0),
        0,
      )
    }
    return (expensesByPond ?? []).reduce((s, g) => s + Number(amountMap(g.categories).get(key) || 0), 0)
  }

  const grandIncome = grandTotals
    ? Number(grandTotals.total_income)
    : incomeKeys.reduce((s, k) => {
        const scopeAmt = incomeTotalsMap.get(k)
        return s + (scopeAmt != null ? Number(scopeAmt) : incomeColTotal(k))
      }, 0)
  const grandExpense = grandTotals
    ? Number(grandTotals.total_costs_and_expenses)
    : expenseKeys.reduce((s, k) => {
        const scopeAmt = expenseTotalsMap.get(k)
        const col = scopeAmt != null ? Number(scopeAmt) : expenseColTotal(k)
        return s + col
      }, 0)
  const grandNet = grandTotals
    ? Number(grandTotals.net_profit)
    : grandIncome - grandExpense

  const getIncomeLabel = (key: string) =>
    labelForKey(incomeByPond ?? [], incomeByCategory ?? [], incomeColumns, key)
  const getExpenseLabel = (key: string) =>
    labelForKey(expensesByPond ?? [], expensesByCategory ?? [], expenseColumns, key)

  if (pondOrder.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No pond income or expense data in this period.</p>
    )
  }

  return (
    <div>
      <h4 className="font-semibold text-foreground mb-1">P&amp;L — every income and expense</h4>
      <p className="mb-2 text-xs text-muted-foreground">
        {pondScopeLabel ? `Scope: ${pondScopeLabel}. ` : ''}
        {formulaNote ??
          'Every registered income type and expense category is a column (zero where none in the period). Net profit = Total income − Total costs & expenses.'}
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th
                rowSpan={2}
                className="sticky left-0 z-10 bg-muted/40 px-3 py-2 text-left font-medium text-muted-foreground align-bottom"
              >
                Pond
              </th>
              {incomeKeys.length > 0 ? (
                <th
                  colSpan={incomeKeys.length + 1}
                  className="border-l border-border px-3 py-2 text-center font-semibold text-emerald-800 bg-emerald-50/80"
                >
                  Income
                </th>
              ) : null}
              {expenseKeys.length > 0 ? (
                <th
                  colSpan={expenseKeys.length + 1}
                  className="border-l border-border px-3 py-2 text-center font-semibold text-rose-900 bg-rose-50/80"
                >
                  Expenses
                </th>
              ) : null}
              <th
                rowSpan={2}
                className="border-l border-border px-3 py-2 text-right font-medium text-primary align-bottom whitespace-nowrap"
              >
                Net profit
              </th>
            </tr>
            <tr>
              {incomeKeys.map((key) => (
                <th
                  key={`inc-h-${key}`}
                  className="border-l border-border/50 px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap text-xs"
                >
                  {getIncomeLabel(key)}
                </th>
              ))}
              {incomeKeys.length > 0 ? (
                <th className="px-3 py-2 text-right font-semibold text-emerald-900 whitespace-nowrap text-xs">
                  Income total
                </th>
              ) : null}
              {expenseKeys.map((key) => (
                <th
                  key={`exp-h-${key}`}
                  className="border-l border-border/50 px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap text-xs"
                >
                  {getExpenseLabel(key)}
                </th>
              ))}
              {expenseKeys.length > 0 ? (
                <th className="px-3 py-2 text-right font-semibold text-rose-950 whitespace-nowrap text-xs">
                  Total costs &amp; expenses
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70 bg-white">
            {pondOrder.map((pond) => {
              const incMap = amountMap(incomeGroupMap.get(pond.id)?.categories)
              const expMap = amountMap(expenseGroupMap.get(pond.id)?.categories)
              const rowTotals = rowTotalsMap.get(pond.id)
              const incRow = rowTotals ? Number(rowTotals.income_total) : incomeKeys.reduce((s, k) => s + Number(incMap.get(k) || 0), 0)
              const expRow = rowTotals
                ? Number(rowTotals.expense_total)
                : sumExpenseColumns(expMap, expenseKeys)
              const net = rowTotals ? Number(rowTotals.net_profit) : incRow - expRow
              return (
                <tr key={pond.id}>
                  <td className="sticky left-0 z-10 bg-white px-3 py-2 font-medium text-foreground">
                    {pond.name}
                  </td>
                  {incomeKeys.map((key) => {
                    const amt = incMap.get(key) || '0'
                    const n = Number(amt)
                    return (
                      <td
                        key={`${pond.id}-inc-${key}`}
                        className={`border-l border-border/30 px-3 py-2 text-right tabular-nums ${n === 0 ? 'text-muted-foreground/50' : ''}`}
                      >
                        {MoneyBdt(amt)}
                      </td>
                    )
                  })}
                  {incomeKeys.length > 0 ? (
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-emerald-900">
                      {MoneyBdt(String(incRow))}
                    </td>
                  ) : null}
                  {expenseKeys.map((key) => {
                    const raw = expMap.get(key) || '0'
                    const display = displayExpenseAmount(key, raw)
                    const n = Number(display)
                    return (
                      <td
                        key={`${pond.id}-exp-${key}`}
                        className={`border-l border-border/30 px-3 py-2 text-right tabular-nums ${n === 0 ? 'text-muted-foreground/50' : n < 0 ? 'text-rose-800' : ''}`}
                      >
                        {MoneyBdt(display)}
                      </td>
                    )
                  })}
                  {expenseKeys.length > 0 ? (
                    <td className="px-3 py-2 text-right tabular-nums font-medium text-rose-950">
                      {MoneyBdt(String(expRow))}
                    </td>
                  ) : null}
                  <td className="border-l border-border px-3 py-2 text-right tabular-nums font-semibold text-primary">
                    {MoneyBdt(String(net))}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-muted">
            <tr>
              <td className="sticky left-0 z-10 bg-muted px-3 py-2 font-bold text-foreground">Grand total</td>
              {incomeKeys.map((key) => {
                const scopeAmt = incomeTotalsMap.get(key)
                const sum = scopeAmt != null ? Number(scopeAmt) : incomeColTotal(key)
                return (
                  <td
                    key={`gt-inc-${key}`}
                    className="border-l border-border/30 px-3 py-2 text-right font-bold tabular-nums text-foreground"
                  >
                    {MoneyBdt(String(sum))}
                  </td>
                )
              })}
              {incomeKeys.length > 0 ? (
                <td className="px-3 py-2 text-right font-bold tabular-nums text-emerald-900">
                  {MoneyBdt(String(grandIncome))}
                </td>
              ) : null}
              {expenseKeys.map((key) => {
                const scopeAmt = expenseTotalsMap.get(key)
                const sum = scopeAmt != null ? Number(scopeAmt) : expenseColTotal(key)
                const display =
                  key === 'fish_transfer_cost_out' && sum !== 0 ? String(-Math.abs(sum)) : String(sum)
                return (
                  <td
                    key={`gt-exp-${key}`}
                    className={`border-l border-border/30 px-3 py-2 text-right font-bold tabular-nums ${Number(display) < 0 ? 'text-rose-900' : 'text-foreground'}`}
                  >
                    {MoneyBdt(display)}
                  </td>
                )
              })}
              {expenseKeys.length > 0 ? (
                <td className="px-3 py-2 text-right font-bold tabular-nums text-rose-950">
                  {MoneyBdt(String(grandExpense))}
                </td>
              ) : null}
              <td className="border-l border-border px-3 py-2 text-right font-bold tabular-nums text-primary">
                {MoneyBdt(String(grandNet))}
              </td>
            </tr>
            <tr className="border-t border-border bg-muted/80">
              <td
                colSpan={1 + incomeKeys.length + (incomeKeys.length > 0 ? 1 : 0) + expenseKeys.length + (expenseKeys.length > 0 ? 1 : 0) + 1}
                className="px-3 py-2 text-xs text-muted-foreground"
              >
                <span className="font-semibold text-foreground">Formula: </span>
                Net profit = Total income ({MoneyBdt(String(grandIncome))}) − Total costs &amp; expenses (
                {MoneyBdt(String(grandExpense))}) ={' '}
                <span className="font-semibold text-primary">{MoneyBdt(String(grandNet))}</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

export function AquaculturePlCategoryMatrices({
  incomeByPond = [],
  incomeByCategory = [],
  expensesByPond = [],
  expensesByCategory = [],
  incomeColumns,
  expenseColumns,
  showFullCatalog = false,
  pondScopeLabel,
  combinedMode = false,
  rowTotalsByPond,
  grandTotals,
  formulaNote,
}: AquaculturePlCategoryMatricesProps) {
  if (combinedMode) {
    return (
      <CombinedIncomeExpenseMatrix
        incomeByPond={incomeByPond}
        incomeByCategory={incomeByCategory}
        expensesByPond={expensesByPond}
        expensesByCategory={expensesByCategory}
        incomeColumns={incomeColumns}
        expenseColumns={expenseColumns}
        showFullCatalog={showFullCatalog}
        pondScopeLabel={pondScopeLabel}
        rowTotalsByPond={rowTotalsByPond}
        grandTotals={grandTotals}
        formulaNote={formulaNote}
      />
    )
  }

  const scopeNote = pondScopeLabel
    ? `Scope: ${pondScopeLabel}.`
    : showFullCatalog
      ? 'All income and expense categories are listed (zero where none in the period).'
      : 'Only categories with activity in the selected scope are shown.'

  const incomeKeys = columnKeysFromSources(
    incomeByPond,
    incomeByCategory,
    incomeColumns,
    showFullCatalog,
  )
  const expenseKeys = columnKeysFromSources(
    expensesByPond,
    expensesByCategory,
    expenseColumns,
    showFullCatalog,
  )
  const hasPondRows = incomeByPond.length > 0 || expensesByPond.length > 0

  return (
    <div className="space-y-8">
      <p className="text-xs text-muted-foreground">{scopeNote}</p>

      {hasPondRows && incomeByPond.length > 0 ? (
        <CategoryMatrixTable
          title="Income by type — all ponds"
          description="Every pond income type in scope. Row total is the sum of income columns."
          groups={incomeByPond}
          scopeTotals={incomeByCategory}
          columnKeys={incomeKeys}
          getLabel={(key) => labelForKey(incomeByPond, incomeByCategory, incomeColumns, key)}
        />
      ) : incomeByCategory.length > 0 ? (
        <CategoryMatrixTable
          title="Income by type"
          description="All registered pond income types for the selected entity and period."
          groups={[{ pond_id: 0, pond_name: pondScopeLabel ?? 'Scope', categories: incomeByCategory }]}
          scopeTotals={incomeByCategory}
          columnKeys={incomeKeys}
          getLabel={(key) => labelForKey([], incomeByCategory, incomeColumns, key)}
        />
      ) : null}

      {hasPondRows && expensesByPond.length > 0 ? (
        <CategoryMatrixTable
          title="Expenses by category — all ponds"
          description="Operating expenses: feed, medicine, fry/fingerling, lease, soil cut, transport, salaries, and all other categories by pond."
          groups={expensesByPond}
          scopeTotals={expensesByCategory}
          columnKeys={expenseKeys}
          getLabel={(key) => labelForKey(expensesByPond, expensesByCategory, expenseColumns, key)}
        />
      ) : expensesByCategory.length > 0 ? (
        <CategoryMatrixTable
          title="Expenses by category"
          description="All expense categories for the selected entity and period."
          groups={[{ pond_id: 0, pond_name: pondScopeLabel ?? 'Scope', categories: expensesByCategory }]}
          scopeTotals={expensesByCategory}
          columnKeys={expenseKeys}
          getLabel={(key) => labelForKey([], expensesByCategory, expenseColumns, key)}
        />
      ) : null}
    </div>
  )
}

export interface PlTotalsLike {
  revenue?: string
  revenue_fish_sales?: string
  revenue_empty_sack_sales?: string
  revenue_other_income?: string
  feed_consumption_cost?: string
  medicine_consumption_cost?: string
  other_consumption_cost?: string
  fry_fingerling_cost?: string
  lease_cost?: string
  salaries_and_payroll_cost?: string
  pond_care_products_cost?: string
  equipment_cost?: string
  other_operating_expenses?: string
  payroll_allocated?: string
  total_costs?: string
  total_costs_and_expenses?: string
  profit?: string
  net_profit?: string
}

/** Summary KPI cards for pond P&L expense and profit lines. */
export function AquaculturePlExpenseKpiGrid({ totals }: { totals: PlTotalsLike }) {
  const cards: [string, string | undefined][] = [
    ['Feed consumption', totals.feed_consumption_cost],
    ['Medicine consumption', totals.medicine_consumption_cost],
    ['Other consumption', totals.other_consumption_cost],
    ['Fry / fingerling', totals.fry_fingerling_cost],
    ['Lease', totals.lease_cost],
    ['Salaries & payroll', totals.salaries_and_payroll_cost],
    ['Equipment & maintenance', totals.equipment_cost],
    ['Other operating', totals.other_operating_expenses],
    ['Total revenue', totals.revenue],
    ['Total costs & expenses', totals.total_costs_and_expenses ?? totals.total_costs],
    ['Net profit', totals.net_profit ?? totals.profit],
  ]
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
      {cards.map(([label, val]) => (
        <div key={label} className="rounded-xl border border-border bg-white p-4 shadow-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{MoneyBdt(val ?? '0')}</p>
        </div>
      ))}
    </div>
  )
}

/** Compact list of every expense category with activity in the period. */
export function PlActiveExpenseCategoriesList({
  categories,
  title = 'All pond expenses in this period',
}: {
  categories?: PlCategoryRow[]
  title?: string
}) {
  const active = (categories ?? [])
    .filter((c) => Number(c.amount ?? 0) !== 0)
    .sort((a, b) => Number(b.amount) - Number(a.amount))
  if (active.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No pond expenses recorded in this period.</p>
    )
  }
  const total = active.reduce((s, c) => s + Number(c.amount || 0), 0)
  return (
    <div>
      <h4 className="font-semibold text-foreground mb-1">{title}</h4>
      <p className="mb-2 text-xs text-muted-foreground">
        Every expense category with activity — vendor bills, cash costs, feed/medicine use, payroll, lease, transfers, and shared splits.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground">Expense category</th>
              <th className="px-3 py-2 text-right font-medium text-muted-foreground">Amount (BDT)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70 bg-white">
            {active.map((c) => (
              <tr key={c.category}>
                <td className="px-3 py-2 text-foreground">{c.label || c.category.replace(/_/g, ' ')}</td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">{MoneyBdt(c.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-muted">
            <tr>
              <td className="px-3 py-2 font-bold text-foreground">Total — listed categories</td>
              <td className="px-3 py-2 text-right font-bold tabular-nums text-foreground">{MoneyBdt(String(total))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
