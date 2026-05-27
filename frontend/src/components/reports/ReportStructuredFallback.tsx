'use client'

import { formatCurrency } from '@/utils/formatting'

type Props = {
  reportType: string
  data: Record<string, unknown>
}

function formatCell(value: unknown): string {
  if (value == null) return '—'
  if (typeof value === 'number') return formatCurrency(value)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function AutoTable({ title, rows }: { title: string; rows: Record<string, unknown>[] }) {
  if (!rows.length) return null
  const cols = Object.keys(rows[0]).filter((k) => {
    const v = rows[0][k]
    return v == null || typeof v !== 'object'
  })
  if (cols.length < 1) return null
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
      <h3 className="border-b bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-900">{title}</h3>
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 text-left text-xs font-medium uppercase text-gray-500">
                {c.replace(/_/g, ' ')}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-gray-50">
              {cols.map((c) => (
                <td key={c} className="whitespace-nowrap px-3 py-2 text-gray-900">
                  {formatCell(row[c])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Renders readable tables from report JSON when no dedicated view exists. */
export function ReportStructuredFallback({ reportType, data }: Props) {
  const skip = new Set(['period', 'report_id', 'accounting_note'])
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
      <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        Structured view for <strong>{reportType}</strong>. Use CSV export for spreadsheets; JSON export
        retains the full API payload.
      </p>
      {typeof data.accounting_note === 'string' && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {data.accounting_note}
        </p>
      )}
      {summary && Object.keys(summary).length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Object.entries(summary).map(([k, v]) => (
            <div key={k} className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
              <p className="text-xs uppercase text-gray-500">{k.replace(/_/g, ' ')}</p>
              <p className="mt-1 text-lg font-semibold text-gray-900">{formatCell(v)}</p>
            </div>
          ))}
        </div>
      )}
      {tables.length > 0 ? (
        tables.map((t) => <AutoTable key={t.title} title={t.title} rows={t.rows} />)
      ) : (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-center text-sm text-gray-600">
          No tabular sections in this response. Expand JSON below or adjust filters and dates.
        </div>
      )}
      <details className="rounded-lg border border-gray-200 bg-gray-50">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-gray-700">Raw JSON</summary>
        <pre className="max-h-80 overflow-auto p-4 text-xs text-gray-700">{JSON.stringify(data, null, 2)}</pre>
      </details>
    </div>
  )
}
