'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDateOnly } from '@/utils/date'
import { useMemo, useState } from 'react'

type Row = { account_code: string; account_name: string; account_type: string; balance: number }

type BalanceSheetResponse = {
  as_on_date: string
  assets: Row[]
  liabilities: Row[]
  equity: Row[]
  total_assets: number
  total_liabilities: number
  total_equity: number
}

function fmtMoney(n: number) {
  try {
    return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
  } catch {
    return n.toFixed(2)
  }
}

function Section({
  title,
  rows,
  total,
}: {
  title: string
  rows: Row[]
  total: number
}) {
  if (rows.length === 0) {
    return (
      <div>
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <p className="mt-2 text-sm text-gray-500">No balances in this section.</p>
      </div>
    )
  }
  return (
    <div>
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <table className="mt-2 min-w-full divide-y divide-gray-200 text-sm">
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => (
            <tr key={row.account_code}>
              <td className="py-2 pr-4 font-mono text-gray-600">{row.account_code}</td>
              <td className="py-2 text-gray-900">{row.account_name}</td>
              <td className="py-2 text-right tabular-nums font-medium">{fmtMoney(row.balance)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-gray-300 font-semibold">
            <td colSpan={2} className="py-2 text-gray-800">
              Total {title.toLowerCase()}
            </td>
            <td className="py-2 text-right tabular-nums">{fmtMoney(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

export default function BalanceSheetPage() {
  const [asOn, setAsOn] = useState(() => new Date().toISOString().slice(0, 10))

  const query = useQuery({
    queryKey: ['balance-sheet', asOn],
    queryFn: async () => {
      const res = await api.get<BalanceSheetResponse>(`/accounting/balance-sheet`, {
        params: { as_on_date: `${asOn}T23:59:59` },
      })
      return res.data
    },
    retry: false,
  })

  const err = (query.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail

  const labelDate = useMemo(() => {
    try {
      return formatDateOnly(query.data?.as_on_date || asOn)
    } catch {
      return asOn
    }
  }, [query.data?.as_on_date, asOn])

  return (
    <div className="max-w-5xl space-y-8">
      <ReportingHubBreadcrumb current="Balance sheet" />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Balance sheet</h1>
          <p className="mt-1 text-sm text-gray-600">Assets, liabilities, and equity from posted journals.</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="bs-date" className="text-sm text-gray-600">
            As on
          </label>
          <input
            id="bs-date"
            type="date"
            value={asOn}
            onChange={(e) => setAsOn(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {typeof err === 'string' ? err : 'Could not load balance sheet.'}
        </div>
      )}

      {query.isLoading && <p className="text-sm text-gray-500">Loading…</p>}

      {query.data && (
        <div className="space-y-8">
          <p className="text-xs text-gray-500">Cut-off: {labelDate}</p>
          <div className="grid gap-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm md:grid-cols-1">
            <Section title="Assets" rows={query.data.assets} total={query.data.total_assets} />
            <Section title="Liabilities" rows={query.data.liabilities} total={query.data.total_liabilities} />
            <Section title="Equity" rows={query.data.equity} total={query.data.total_equity} />
          </div>
          <p className="text-xs text-gray-500">
            Liabilities and equity are shown as credit-normal balances. Total assets should reconcile with
            liabilities plus equity when the chart is complete.
          </p>
        </div>
      )}
    </div>
  )
}
