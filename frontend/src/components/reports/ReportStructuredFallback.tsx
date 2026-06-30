'use client'

import { ReportAmountCell } from '@/components/reports/ReportAmountCell'
import { documentsTotalRow, itemsTotalRow } from '@/components/reports/reportDrillAggregate'
import type { ReportDrillScope } from '@/components/reports/reportDrillResolver'
import { formatCurrency } from '@/utils/formatting'

type Props = {
  reportType: string
  data: Record<string, unknown>
  drillScope?: ReportDrillScope
}

const MONEY_KEY =
  /amount|balance|total|revenue|cost|value|debit|credit|price|paid|profit|income|expense|cogs|deposit|withdraw|outstanding|payment|sales|purchase/i

function isMoneyColumn(key: string, value: unknown): boolean {
  if (typeof value !== 'number') return false
  return MONEY_KEY.test(key)
}

function formatCell(value: unknown, row: Record<string, unknown>, col: string, scope: ReportDrillScope): React.ReactNode {
  if (value == null) return '—'
  if (typeof value === 'number') {
    if (isMoneyColumn(col, value)) {
      return <ReportAmountCell amount={value} row={row} field={col} scope={scope} />
    }
    return String(value)
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function AutoTable({
  title,
  rows,
  scope,
}: {
  title: string
  rows: Record<string, unknown>[]
  scope: ReportDrillScope
}) {
  if (!rows.length) return null
  const cols = Object.keys(rows[0]).filter((k) => {
    if (k === '_drill') return false
    const v = rows[0][k]
    return v == null || typeof v !== 'object'
  })
  if (cols.length < 1) return null
  const moneyCols = cols.filter((c) => isMoneyColumn(c, rows[0][c]))
  const totals = moneyCols.reduce<Record<string, number>>((acc, c) => {
    acc[c] = rows.reduce((s, r) => s + Number(r[c] ?? 0), 0)
    return acc
  }, {})
  const totalRow =
    moneyCols.length > 0
      ? {
          ...documentsTotalRow(rows, {
            title: `${title} — total`,
            entityType: 'customers',
          }),
          ...itemsTotalRow(rows, `${title} — total`, moneyCols),
        }
      : {}
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-white shadow-sm">
      <h3 className="border-b bg-muted/40 px-4 py-3 text-sm font-semibold text-foreground">{title}</h3>
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-muted/40">
          <tr>
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 text-left text-xs font-medium uppercase text-muted-foreground">
                {c.replace(/_/g, ' ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/70">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-muted/40">
              {cols.map((c) => (
                <td key={c} className="whitespace-nowrap px-3 py-2 text-foreground">
                  {formatCell(row[c], row, c, scope)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {moneyCols.length > 0 && (
          <tfoot className="bg-muted/40 font-semibold">
            <tr>
              {cols.map((c, i) => (
                <td key={`tot-${c}`} className="whitespace-nowrap px-3 py-2 text-foreground">
                  {i === 0 ? 'Total' : moneyCols.includes(c) ? (
                    <ReportAmountCell amount={totals[c]} row={totalRow} field={c} scope={scope} />
                  ) : (
                    ''
                  )}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

/** Renders readable tables from report JSON when no dedicated view exists. */
export function ReportStructuredFallback({ reportType, data, drillScope = {} }: Props) {
  const scope: ReportDrillScope = { ...drillScope, reportType }
  const skip = new Set(['period', 'report_id', 'accounting_note', 'filters', 'summary'])
  const summary = data.summary as Record<string, unknown> | undefined
  const tables: { title: string; rows: Record<string, unknown>[] }[] = []

  for (const [key, val] of Object.entries(data)) {
    if (skip.has(key) || !Array.isArray(val) || val.length === 0) continue
    const first = val[0]
    if (!first || typeof first !== 'object' || Array.isArray(first)) continue
    tables.push({ title: key.replace(/_/g, ' '), rows: val as Record<string, unknown>[] })
  }

  return (
    <div className="space-y-6">
      <p className="rounded-lg border border-primary/25 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        Structured view for <strong>{reportType}</strong>. Click underlined amounts to drill into source
        detail. Use CSV/JSON export for spreadsheets.
      </p>
      {typeof data.accounting_note === 'string' && (
        <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-foreground/85">
          {data.accounting_note}
        </p>
      )}
      {summary && Object.keys(summary).length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Object.entries(summary).map(([k, v]) => (
            <div key={k} className="rounded-lg border border-border bg-white p-3 shadow-sm">
              <p className="text-xs uppercase text-muted-foreground">{k.replace(/_/g, ' ')}</p>
              <p className="mt-1 text-lg font-semibold text-foreground">
                {typeof v === 'number' && isMoneyColumn(k, v) ? (
                  <ReportAmountCell amount={v} row={summary} field={k} scope={scope} />
                ) : (
                  formatCell(v, summary, k, scope)
                )}
              </p>
            </div>
          ))}
        </div>
      )}
      {tables.length > 0 ? (
        tables.map((t) => <AutoTable key={t.title} title={t.title} rows={t.rows} scope={scope} />)
      ) : (
        <div className="rounded-lg border border-border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
          No tabular sections in this response. Expand JSON below or adjust filters and dates.
        </div>
      )}
      <details className="rounded-lg border border-border bg-muted/40">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-foreground/85">Raw JSON</summary>
        <pre className="max-h-80 overflow-auto p-4 text-xs text-foreground/85">{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  )
}
