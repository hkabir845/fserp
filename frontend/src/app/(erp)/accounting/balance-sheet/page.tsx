'use client'

import { CompanyDateInput } from '@/components/CompanyDateInput'

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
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">No balances in this section.</p>
      </div>
    )
  }
  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="mt-2 overflow-x-auto">
      <table className="min-w-full divide-y divide-border text-sm">
        <tbody className="divide-y divide-border/70">
          {rows.map((row) => (
            <tr key={row.account_code}>
              <td className="py-2 pr-4 font-mono text-muted-foreground">{row.account_code}</td>
              <td className="py-2 text-foreground">{row.account_name}</td>
              <td className="py-2 text-right tabular-nums font-medium">{fmtMoney(row.balance)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border font-semibold">
            <td colSpan={2} className="py-2 text-foreground">
              Total {title.toLowerCase()}
            </td>
            <td className="py-2 text-right tabular-nums">{fmtMoney(total)}</td>
          </tr>
        </tfoot>
      </table>
      </div>
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
          <h1 className="text-2xl font-bold text-foreground">Balance sheet</h1>
          <p className="mt-1 text-sm text-muted-foreground">Assets, liabilities, and equity from posted journals.</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="bs-date" className="text-sm text-muted-foreground">
            As on
          </label>
          <CompanyDateInput value={asOn} onChange={setAsOn} className="rounded-lg border border-border px-3 py-2 text-sm" id="bs-date" />
        </div>
      </div>

      {err && (
        <div className="erp-alert-warning">
          {typeof err === 'string' ? err : 'Could not load balance sheet.'}
        </div>
      )}

      {query.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {query.data && (
        <div className="space-y-8">
          <p className="text-xs text-muted-foreground">Cut-off: {labelDate}</p>
          <div className="grid gap-8 rounded-xl border border-border bg-white p-6 shadow-sm md:grid-cols-1">
            <Section title="Assets" rows={query.data.assets} total={query.data.total_assets} />
            <Section title="Liabilities" rows={query.data.liabilities} total={query.data.total_liabilities} />
            <Section title="Equity" rows={query.data.equity} total={query.data.total_equity} />
          </div>
          <p className="text-xs text-muted-foreground">
            Liabilities and equity are shown as credit-normal balances. Total assets should reconcile with
            liabilities plus equity when the chart is complete.
          </p>
        </div>
      )}
    </div>
  )
}
