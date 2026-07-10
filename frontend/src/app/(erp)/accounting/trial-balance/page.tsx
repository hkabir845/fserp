'use client'

import { CompanyDateInput } from '@/components/CompanyDateInput'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDateOnly } from '@/utils/date'
import { useMemo, useState } from 'react'

type TrialBalanceResponse = {
  as_on_date: string
  lines: { account_code: string; account_name: string; debit: number; credit: number; balance: number }[]
  total_debit: number
  total_credit: number
}

function fmtMoney(n: number) {
  try {
    return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
  } catch {
    return n.toFixed(2)
  }
}

export default function TrialBalancePage() {
  const [asOn, setAsOn] = useState(() => new Date().toISOString().slice(0, 10))

  const query = useQuery({
    queryKey: ['trial-balance', asOn],
    queryFn: async () => {
      const res = await api.get<TrialBalanceResponse>(`/accounting/trial-balance`, {
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
    <div className="max-w-5xl space-y-6">
      <ReportingHubBreadcrumb current="Trial balance" />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Trial balance</h1>
          <p className="mt-1 text-sm text-muted-foreground">Posted journals aggregated by account up to the selected date.</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="tb-date" className="text-sm text-muted-foreground">
            As on
          </label>
          <CompanyDateInput value={asOn} onChange={setAsOn} className="rounded-lg border border-border px-3 py-2 text-sm" id="tb-date" />
        </div>
      </div>

      {err && (
        <div className="erp-alert-warning">
          {typeof err === 'string' ? err : 'Could not load trial balance.'}
        </div>
      )}

      {query.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {query.data && (
        <>
          <p className="text-xs text-muted-foreground">Cut-off: {labelDate}</p>
          <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Code</th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">Account</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Debit</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Credit</th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">Balance (Dr − Cr)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {query.data.lines.map((row) => (
                  <tr key={row.account_code}>
                    <td className="px-4 py-2 font-mono text-muted-foreground">{row.account_code}</td>
                    <td className="px-4 py-2 text-foreground">{row.account_name}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(row.debit)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(row.credit)}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">{fmtMoney(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-border bg-muted/40 font-semibold">
                <tr>
                  <td colSpan={2} className="px-4 py-3 text-foreground">
                    Totals
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(query.data.total_debit)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(query.data.total_credit)}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground/70">—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
