'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

type PR = {
  id: number
  doc_number: string
  supplier_id: number | null
  warehouse_id: number | null
  status: string
  needed_by?: string | null
  purpose?: string | null
  converted_po_id: number | null
  created_by: number | null
}

function StatusPill({ status }: { status: string }) {
  const s = (status || '').toLowerCase()
  const cls =
    s === 'approved'
      ? 'bg-green-50 text-success ring-green-200'
      : s === 'rejected'
        ? 'bg-destructive/5 text-destructive ring-red-200'
        : s === 'draft'
          ? 'bg-warning/10 text-warning-foreground ring-amber-200'
          : s.includes('pending')
            ? 'bg-accent text-primary ring-indigo-200'
            : 'bg-muted/40 text-foreground/85 ring-gray-200'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ring-1 ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

export default function PurchaseRequisitionsPage() {
  const [status, setStatus] = useState('')
  const { data: rows = [], refetch, isFetching } = useQuery<PR[]>({
    queryKey: ['purchase-requisitions', status],
    queryFn: async () => {
      const q = status ? `?status=${encodeURIComponent(status)}` : ''
      const res = await api.get(`/requisitions/purchase${q}`)
      return res.data || []
    },
    retry: false,
    refetchOnWindowFocus: false,
  })

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.status, (m.get(r.status) || 0) + 1)
    return m
  }, [rows])

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <ReportingHubBreadcrumb current="Purchase requisitions" className="mb-4" />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Purchase requisitions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Internal requests with department head approval, then executive sign-off (GM / Head of Accounts / MD).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/requisitions/inbox"
            className="rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium text-foreground/85 shadow-sm hover:bg-muted/40"
          >
            Approvals inbox
          </Link>
          <Link
            href="/purchase/requisitions/new"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow hover:bg-accent0"
          >
            New requisition
          </Link>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label className="text-sm text-muted-foreground">Filter</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-border bg-white px-3 py-2 text-sm shadow-sm"
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="pending_dept_head">Pending department</option>
          <option value="pending_executive">Pending executive</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <button
          type="button"
          onClick={() => refetch()}
          className="text-sm font-medium text-primary hover:text-primary"
        >
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
        {counts.size > 0 && (
          <span className="text-xs text-muted-foreground">
            Showing {rows.length} — {Array.from(counts.entries())
              .map(([k, v]) => `${k}: ${v}`)
              .join(' · ')}
          </span>
        )}
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-border bg-white shadow-sm">
        <table className="min-w-full divide-y divide-border text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-foreground/85">Document</th>
              <th className="px-4 py-3 text-left font-semibold text-foreground/85">Status</th>
              <th className="px-4 py-3 text-left font-semibold text-foreground/85">PO</th>
              <th className="px-4 py-3 text-right font-semibold text-foreground/85"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/70">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-muted-foreground">
                  No purchase requisitions yet.{' '}
                  <Link href="/purchase/requisitions/new" className="font-medium text-primary hover:text-primary">
                    Create one
                  </Link>
                  .
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-muted/40/80">
                  <td className="px-4 py-3 font-medium text-foreground">{r.doc_number}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {r.converted_po_id ? (
                      <Link href={`/purchase/orders/${r.converted_po_id}`} className="text-primary hover:underline">
                        PO #{r.converted_po_id}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/purchase/requisitions/${r.id}`}
                      className="font-medium text-primary hover:text-primary"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
