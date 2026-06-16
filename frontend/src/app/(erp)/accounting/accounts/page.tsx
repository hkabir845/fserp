'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useState } from 'react'

type Account = { id: number; code: string; name: string; type: string; is_active: boolean }

function apiErrorDetail(err: unknown): string {
  const d = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) {
    return d
      .map((item) =>
        typeof item === 'object' && item && 'msg' in item ? String((item as { msg: string }).msg) : JSON.stringify(item)
      )
      .join(' ')
  }
  return 'Could not load chart of accounts. Select a tenant in the company switcher (tenant data is not available in Master company mode).'
}

export default function ChartOfAccountsPage() {
  const qc = useQueryClient()
  const [confirmReplace, setConfirmReplace] = useState(false)

  const { data: accounts = [], isLoading, error } = useQuery({
    queryKey: ['gl-accounts'],
    queryFn: async () => {
      const res = await api.get<Account[]>('/accounting/accounts')
      return res.data
    },
    retry: false,
  })

  const applyTemplate = useMutation({
    mutationFn: async (replace: boolean) => {
      const res = await api.post('/accounting/accounts/apply-feed-mill-template', {
        replace_existing: replace,
      })
      return res.data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gl-accounts'] })
      setConfirmReplace(false)
    },
  })

  return (
          <div className="max-w-5xl space-y-6">
        <ReportingHubBreadcrumb current="Chart of accounts" />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Chart of accounts</h1>
          <p className="mt-1 text-sm text-gray-600">
            Feed–mill template: current assets (grain, additives, finished feed, fleet), payables, equity, revenue, COGS, distribution, field travel & employee claims, QC, and admin.
            Safe to run on an empty ledger; replacing deletes existing accounts (only use on new companies).
          </p>
        </div>

        {error ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            {apiErrorDetail(error)}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
          <button
            type="button"
            disabled={applyTemplate.isPending}
            onClick={() => applyTemplate.mutate(false)}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Apply feed mill COA template
          </button>
          <button
            type="button"
            onClick={() => setConfirmReplace((v) => !v)}
            className="text-sm font-medium text-red-700 underline"
          >
            Replace all accounts (danger)
          </button>
        </div>
        {confirmReplace ? (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
            <p>This deletes existing accounts for this tenant. Only for new tenants with no posted journals.</p>
            <button
              type="button"
              onClick={() => applyTemplate.mutate(true)}
              className="mt-2 rounded-md bg-red-700 px-3 py-1.5 font-semibold text-white"
            >
              Confirm replace & apply template
            </button>
          </div>
        ) : null}

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          {isLoading ? (
            <div className="p-6 text-sm text-gray-500">Loading…</div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-600">Code</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-600">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-600">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {accounts.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-sm text-gray-900">{a.code}</td>
                    <td className="px-4 py-2 text-sm text-gray-800">{a.name}</td>
                    <td className="px-4 py-2 text-xs uppercase text-gray-500">{a.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
  )
}
