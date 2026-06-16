'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

type SR = {
  id: number
  doc_number: string
  customer_id: number
  status: string
  converted_invoice_id: number | null
  created_by: number | null
}

function StatusPill({ status }: { status: string }) {
  const s = (status || '').toLowerCase()
  const cls =
    s === 'approved'
      ? 'bg-green-50 text-green-700 ring-green-200'
      : s === 'rejected'
        ? 'bg-red-50 text-red-700 ring-red-200'
        : s === 'draft'
          ? 'bg-amber-50 text-amber-700 ring-amber-200'
          : s.includes('pending')
            ? 'bg-indigo-50 text-indigo-700 ring-indigo-200'
            : 'bg-gray-50 text-gray-700 ring-gray-200'
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold ring-1 ${cls}`}>
      {status.replace(/_/g, ' ')}
    </span>
  )
}

export default function SalesRequisitionsPage() {
  const [status, setStatus] = useState('')
  const { data: rows = [], refetch, isFetching } = useQuery<SR[]>({
    queryKey: ['sales-requisitions', status],
    queryFn: async () => {
      const q = status ? `?status=${encodeURIComponent(status)}` : ''
      const res = await api.get(`/requisitions/sales${q}`)
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
      <ReportingHubBreadcrumb current="Sales requisitions" className="mb-4" />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Sales requisitions</h1>
          <p className="mt-1 text-sm text-gray-600">
            Commercial requests: sales head approval, then executive (GM / Head of Accounts / MD).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/requisitions/inbox"
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Approvals inbox
          </Link>
          <Link
            href="/sales/requisitions/new"
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-indigo-500"
          >
            New requisition
          </Link>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <label className="text-sm text-gray-600">Filter</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm"
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
          className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
        >
          {isFetching ? 'Refreshing…' : 'Refresh'}
        </button>
        {counts.size > 0 && (
          <span className="text-xs text-gray-500">
            Showing {rows.length} — {Array.from(counts.entries())
              .map(([k, v]) => `${k}: ${v}`)
              .join(' · ')}
          </span>
        )}
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Document</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Customer</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Status</th>
              <th className="px-4 py-3 text-left font-semibold text-gray-700">Invoice</th>
              <th className="px-4 py-3 text-right font-semibold text-gray-700"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-gray-500">
                  No sales requisitions.{' '}
                  <Link href="/sales/requisitions/new" className="font-medium text-indigo-600 hover:text-indigo-800">
                    Create one
                  </Link>
                  .
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50/80">
                  <td className="px-4 py-3 font-medium text-gray-900">{r.doc_number}</td>
                  <td className="px-4 py-3 text-gray-600">#{r.customer_id}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {r.converted_invoice_id ? (
                      <Link href={`/sales/invoices`} className="text-indigo-600 hover:underline">
                        Invoice #{r.converted_invoice_id}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/sales/requisitions/${r.id}`} className="font-medium text-indigo-600 hover:text-indigo-800">
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
