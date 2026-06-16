'use client'

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
          <h1 className="text-2xl font-bold text-gray-900">Trial balance</h1>
          <p className="mt-1 text-sm text-gray-600">Posted journals aggregated by account up to the selected date.</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="tb-date" className="text-sm text-gray-600">
            As on
          </label>
          <input
            id="tb-date"
            type="date"
            value={asOn}
            onChange={(e) => setAsOn(e.target.value)}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {err && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          {typeof err === 'string' ? err : 'Could not load trial balance.'}
        </div>
      )}

      {query.isLoading && <p className="text-sm text-gray-500">Loading…</p>}

      {query.data && (
        <>
          <p className="text-xs text-gray-500">Cut-off: {labelDate}</p>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Code</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Account</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Debit</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Credit</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Balance (Dr − Cr)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {query.data.lines.map((row) => (
                  <tr key={row.account_code}>
                    <td className="px-4 py-2 font-mono text-gray-600">{row.account_code}</td>
                    <td className="px-4 py-2 text-gray-900">{row.account_name}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(row.debit)}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtMoney(row.credit)}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-medium">{fmtMoney(row.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                <tr>
                  <td colSpan={2} className="px-4 py-3 text-gray-800">
                    Totals
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(query.data.total_debit)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(query.data.total_credit)}</td>
                  <td className="px-4 py-3 text-right text-gray-400">—</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
