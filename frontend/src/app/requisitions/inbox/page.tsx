'use client'

import type { ReactNode } from 'react'
import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

type PR = {
  id: number
  doc_number: string
  status: string
  supplier_id: number | null
  converted_po_id: number | null
  created_by: number | null
}

type SR = {
  id: number
  doc_number: string
  status: string
  customer_id: number
  converted_invoice_id: number | null
  created_by: number | null
}

type Inbox = {
  purchase_pending_dept: PR[]
  purchase_pending_exec: PR[]
  sales_pending_dept: SR[]
  sales_pending_exec: SR[]
  my_drafts_purchase: PR[]
  my_drafts_sales: SR[]
}

function Section({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

export default function RequisitionsInboxPage() {
  const { data, isLoading, refetch, isFetching } = useQuery<Inbox>({
    queryKey: ['requisitions-inbox'],
    queryFn: async () => (await api.get('/requisitions/inbox')).data,
    retry: false,
    refetchOnWindowFocus: false,
  })

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center text-gray-600">
        <ReportingHubBreadcrumb current="Requisitions inbox" className="mb-6 text-left" />
        Loading approvals…
      </div>
    )
  }

  const RowPR = ({ r }: { r: PR }) => (
    <div className="flex items-center justify-between border-b border-gray-100 py-2 last:border-0">
      <span className="font-medium text-gray-900">{r.doc_number}</span>
      <Link href={`/purchase/requisitions/${r.id}`} className="text-sm font-medium text-indigo-600 hover:text-indigo-800">
        Review
      </Link>
    </div>
  )

  const RowSR = ({ r }: { r: SR }) => (
    <div className="flex items-center justify-between border-b border-gray-100 py-2 last:border-0">
      <span className="font-medium text-gray-900">{r.doc_number}</span>
      <Link href={`/sales/requisitions/${r.id}`} className="text-sm font-medium text-indigo-600 hover:text-indigo-800">
        Review
      </Link>
    </div>
  )

  const empty = <p className="text-sm text-gray-500">Nothing here for your roles.</p>

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <ReportingHubBreadcrumb current="Requisitions inbox" className="mb-4" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Requisitions inbox</h1>
          <p className="mt-1 text-sm text-gray-600">
            Queues depend on your roles (procurement head, sales head, executive, or admin).{' '}
            <button type="button" onClick={() => refetch()} className="font-medium text-indigo-600 hover:text-indigo-800">
              {isFetching ? 'Refreshing…' : 'Refresh'}
            </button>
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/purchase/requisitions"
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Purchase list
          </Link>
          <Link
            href="/sales/requisitions"
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Sales list
          </Link>
        </div>
      </div>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <Section title="Purchase — pending department">
          {data.purchase_pending_dept.length ? data.purchase_pending_dept.map((r) => <RowPR key={r.id} r={r} />) : empty}
        </Section>
        <Section title="Purchase — pending executive">
          {data.purchase_pending_exec.length ? data.purchase_pending_exec.map((r) => <RowPR key={r.id} r={r} />) : empty}
        </Section>
        <Section title="Sales — pending department">
          {data.sales_pending_dept.length ? data.sales_pending_dept.map((r) => <RowSR key={r.id} r={r} />) : empty}
        </Section>
        <Section title="Sales — pending executive">
          {data.sales_pending_exec.length ? data.sales_pending_exec.map((r) => <RowSR key={r.id} r={r} />) : empty}
        </Section>
        <Section title="My draft purchase requisitions">
          {data.my_drafts_purchase.length ? data.my_drafts_purchase.map((r) => <RowPR key={r.id} r={r} />) : empty}
        </Section>
        <Section title="My draft sales requisitions">
          {data.my_drafts_sales.length ? data.my_drafts_sales.map((r) => <RowSR key={r.id} r={r} />) : empty}
        </Section>
      </div>
    </div>
  )
}
