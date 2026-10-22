'use client'

import { Fragment, type ReactNode } from 'react'
import { DrillAmount, glAccountDrill } from '@/components/reports/ReportDrillContext'
import { accountsTotalRow } from '@/components/reports/reportDrillAggregate'
import { escapeHtml } from '@/utils/printDocument'
import { formatCurrency } from '@/utils/formatting'

export type IncomeExpenseSheetLine = {
  section?: string
  entity_name?: string | null
  entity_type?: string | null
  entity_id?: number | null
  account_id?: number | null
  account_code?: string
  account_name?: string
  particulars?: string
  income?: string | number
  expense?: string | number
  balance?: string | number
}

type DrillScope = {
  startDate?: string
  endDate?: string
  stationId?: number | null
  pondId?: number | null
  headOffice?: boolean
  reportType?: string
}

function money(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function lineLabel(row: IncomeExpenseSheetLine): string {
  return (row.particulars || row.account_name || '').trim() || '—'
}

function entityKey(row: IncomeExpenseSheetLine): string {
  return row.entity_type
    ? `${row.entity_type}:${row.entity_id ?? ''}`
    : (row.entity_name || '').trim() || 'Unassigned'
}

function groupEntityLines(lines: IncomeExpenseSheetLine[]) {
  const groups = new Map<string, { key: string; entity: string; rows: IncomeExpenseSheetLine[] }>()
  for (const row of lines) {
    const key = entityKey(row)
    if (!groups.has(key)) groups.set(key, { key, entity: (row.entity_name || '').trim() || 'Unassigned', rows: [] })
    groups.get(key)!.rows.push(row)
  }
  return [...groups.values()]
}

function csvEscape(v: unknown): string {
  const s = String(v ?? '')
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function buildIncomeExpenseStatementCsv(data: Record<string, unknown>): string {
  const lines = (Array.isArray(data.lines) ? data.lines : []) as IncomeExpenseSheetLine[]
  const showEntity = data.scope === 'all'
  let out = showEntity
    ? 'Section,Entity,Account code,Particulars,Income,Expense\n'
    : 'Section,Account code,Particulars,Income,Expense\n'
  for (const row of lines) {
    const cells = [
      row.section || '',
      ...(showEntity ? [row.entity_name || ''] : []),
      row.account_code || '',
      lineLabel(row),
      row.income ?? 0,
      row.expense ?? 0,
    ]
    out += cells.map(csvEscape).join(',') + '\n'
  }
  out += '\n'
  out += `Total income,${data.total_income ?? 0}\n`
  out += `Total expense,${data.total_expense ?? 0}\n`
  out += `Balance,${data.balance ?? 0}\n`
  return out
}

export function buildIncomeExpenseStatementPrintHtml(data: Record<string, unknown>): string {
  const lines = (Array.isArray(data.lines) ? data.lines : []) as IncomeExpenseSheetLine[]
  const showEntity = data.scope === 'all'
  const scope = escapeHtml(String(data.scope_label || (showEntity ? 'All' : '')))
  let html = `<p><strong>Scope:</strong> ${scope}</p>`
  html += '<table><thead><tr>'
  if (showEntity) html += '<th>Entity</th>'
  html += '<th>Particulars</th><th style="text-align:right">Income</th><th style="text-align:right">Expense</th></tr></thead><tbody>'
  if (!lines.length) {
    html += `<tr><td colspan="${showEntity ? 4 : 3}">No income or expense in this period.</td></tr>`
  } else {
    let lastEntity: string | null = null
    for (const row of (showEntity ? groupEntityLines(lines).flatMap(g => g.rows) : lines)) {
      const entity = (row.entity_name || '').trim() || 'Unassigned'
      if (showEntity && entityKey(row) !== lastEntity) {
        lastEntity = entityKey(row)
        html += `<tr style="break-after:avoid"><td colspan="4"><strong>${escapeHtml(entity)}</strong></td></tr>`
      }
      html += '<tr>'
      if (showEntity) html += `<td>${escapeHtml(entity)}</td>`
      const code = row.account_code ? `${row.account_code} — ` : ''
      html += `<td>${escapeHtml(code + lineLabel(row))}</td>`
      html += `<td style="text-align:right">${money(row.income) ? escapeHtml(formatCurrency(money(row.income))) : ''}</td>`
      html += `<td style="text-align:right">${money(row.expense) ? escapeHtml(formatCurrency(money(row.expense))) : ''}</td>`
      html += '</tr>'
    }
  }
  html += '</tbody></table>'
  const income = money(data.total_income)
  const expense = money(data.total_expense)
  const balance = money(data.balance)
  html += '<table><tbody>'
  html += `<tr><td><strong>Total income</strong></td><td style="text-align:right">${escapeHtml(formatCurrency(income))}</td></tr>`
  html += `<tr><td><strong>Total expense</strong></td><td style="text-align:right">${escapeHtml(formatCurrency(expense))}</td></tr>`
  html += `<tr><td><strong>Balance</strong></td><td style="text-align:right">${escapeHtml(formatCurrency(balance))}</td></tr>`
  html += '</tbody></table>'
  html += '<p>Balance = Total income − Total expense.</p>'
  return html
}

/**
 * Income and expense on one sheet, with total income, total expense, and balance at the end.
 * All entities, or one station / shop hub / pond. Dates come from the report period (today by default).
 */
export function IncomeExpenseStatementSheet({
  data,
  drillScope,
  Money,
}: {
  data: Record<string, unknown>
  drillScope: DrillScope
  Money: (amount: unknown, row?: Record<string, unknown>, field?: string) => ReactNode
}) {
  const lines = (Array.isArray(data.lines) ? data.lines : []) as IncomeExpenseSheetLine[]
  const showEntity = data.scope === 'all'
  const scopeLabel = String(data.scope_label || (showEntity ? 'All' : '')).trim()
  const incomeTotal = money(data.total_income)
  const expenseTotal = money(data.total_expense)
  const balance = money(data.balance)

  const incomeRows = lines.filter((r) => r.section === 'income')
  const expenseRows = lines.filter((r) => r.section === 'expense')
  const incomeDrill = accountsTotalRow(incomeRows as Record<string, unknown>[], 'Total income')
  const expenseDrill = accountsTotalRow(expenseRows as Record<string, unknown>[], 'Total expense')
  const balanceDrill = accountsTotalRow(lines as Record<string, unknown>[], 'Balance')

  const groups = showEntity ? groupEntityLines(lines) : [{ key: 'sheet', entity: '', rows: lines }]

  const colSpan = showEntity ? 4 : 3

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold text-foreground">Income and expense statement</h3>
        <p className="text-sm text-muted-foreground">
          Scope: <span className="font-medium text-foreground">{scopeLabel || 'All'}</span>
        </p>
      </div>
      {typeof data.accounting_note === 'string' ? (
        <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground/85">
          {data.accounting_note}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-border bg-white shadow-sm">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40">
            <tr>
              {showEntity ? (
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Entity
                </th>
              ) : null}
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Particulars
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-emerald-800">
                Income
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wide text-rose-800">
                Expense
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70 bg-white">
            {lines.length === 0 ? (
              <tr>
                <td colSpan={colSpan} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  No income or expense in this period.
                </td>
              </tr>
            ) : (
              groups.map((group) => (
                <Fragment key={group.key}>
                  {showEntity ? (
                    <tr className="bg-muted/50">
                      <td
                        colSpan={colSpan}
                        className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                      >
                        {group.entity}
                      </td>
                    </tr>
                  ) : null}
                  {group.rows.map((row, idx) => {
                    const gl = glAccountDrill(
                      {
                        account_id: row.account_id ?? undefined,
                        account_code: row.account_code,
                        account_name: lineLabel(row),
                      },
                      showEntity ? {
                        ...drillScope,
                        stationId: row.entity_type === 'station' ? row.entity_id : null,
                        pondId: row.entity_type === 'pond' ? row.entity_id : null,
                        headOffice: row.entity_type === 'unscoped',
                      } : drillScope,
                    )
                    const incomeAmt = money(row.income)
                    const expenseAmt = money(row.expense)
                    return (
                      <tr key={`${group.entity}-${row.account_code}-${idx}`} className="hover:bg-muted/30">
                        {showEntity ? <td className="px-4 py-2.5 text-muted-foreground">{group.entity}</td> : null}
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-foreground">{lineLabel(row)}</p>
                          {row.account_code ? (
                            <p className="text-xs text-muted-foreground">{row.account_code}</p>
                          ) : null}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium tabular-nums text-emerald-900">
                          {incomeAmt !== 0 ? (
                            gl ? (
                              <DrillAmount amount={incomeAmt} drill={gl} />
                            ) : (
                              Money(incomeAmt, row as Record<string, unknown>, 'income')
                            )
                          ) : (
                            ''
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium tabular-nums text-rose-900">
                          {expenseAmt !== 0 ? (
                            gl ? (
                              <DrillAmount amount={expenseAmt} drill={gl} />
                            ) : (
                              Money(expenseAmt, row as Record<string, unknown>, 'expense')
                            )
                          ) : (
                            ''
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))
            )}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-emerald-200 bg-emerald-50/70">
              <td colSpan={showEntity ? 2 : 1} className="px-4 py-3 text-sm font-semibold text-emerald-950">
                Total income
              </td>
              <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-emerald-950">
                {Money(incomeTotal, incomeDrill, 'total')}
              </td>
              <td />
            </tr>
            <tr className="border-t border-rose-200 bg-rose-50/70">
              <td colSpan={showEntity ? 2 : 1} className="px-4 py-3 text-sm font-semibold text-rose-950">
                Total expense
              </td>
              <td />
              <td className="px-4 py-3 text-right text-sm font-bold tabular-nums text-rose-950">
                {Money(expenseTotal, expenseDrill, 'total')}
              </td>
            </tr>
            <tr
              className={`border-t-2 ${
                balance >= 0 ? 'border-blue-300 bg-blue-50' : 'border-destructive/30 bg-destructive/5'
              }`}
            >
              <td
                colSpan={showEntity ? 2 : 1}
                className={`px-4 py-3 text-base font-bold ${
                  balance >= 0 ? 'text-primary' : 'text-destructive'
                }`}
              >
                Balance
                <span className="ml-2 text-xs font-medium text-muted-foreground">
                  Total income − Total expense
                </span>
              </td>
              <td
                colSpan={2}
                className={`px-4 py-3 text-right text-base font-bold tabular-nums ${
                  balance >= 0 ? 'text-primary' : 'text-destructive'
                }`}
              >
                {Money(balance, balanceDrill, 'total')}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
