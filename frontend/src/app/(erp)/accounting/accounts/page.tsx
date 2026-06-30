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
          <h1 className="text-2xl font-bold text-foreground">Chart of accounts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Feed–mill template: current assets (grain, additives, finished feed, fleet), payables, equity, revenue, COGS, distribution, field travel & employee claims, QC, and admin.
            Safe to run on an empty ledger; replacing deletes existing accounts (only use on new companies).
          </p>
        </div>

        {error ? (
          <div className="erp-alert-warning">
            {apiErrorDetail(error)}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/15 bg-accent/50 p-4">
          <button
            type="button"
            disabled={applyTemplate.isPending}
            onClick={() => applyTemplate.mutate(false)}
            className="erp-btn-primary rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            Apply feed mill COA template
          </button>
          <button
            type="button"
            onClick={() => setConfirmReplace((v) => !v)}
            className="text-sm font-medium text-destructive underline"
          >
            Replace all accounts (danger)
          </button>
        </div>
        {confirmReplace ? (
          <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm text-red-900">
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

        <div className="overflow-hidden rounded-xl border border-border bg-white shadow-sm">
          {isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : (
            <table className="min-w-full divide-y divide-border">
              <thead className="bg-muted/40">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Code</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Type</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {accounts.map((a) => (
                  <tr key={a.id} className="hover:bg-muted/40">
                    <td className="px-4 py-2 font-mono text-sm text-foreground">{a.code}</td>
                    <td className="px-4 py-2 text-sm text-foreground">{a.name}</td>
                    <td className="px-4 py-2 text-xs uppercase text-muted-foreground">{a.type}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
  )
}
