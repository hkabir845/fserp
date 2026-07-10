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
    <section className="erp-panel">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
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
      <div className="mx-auto max-w-5xl px-4 py-16 text-center text-muted-foreground">
        <ReportingHubBreadcrumb current="Requisitions inbox" className="mb-6 text-left" />
        Loading approvals…
      </div>
    )
  }

  const RowPR = ({ r }: { r: PR }) => (
    <div className="flex items-center justify-between border-b border-border/70 py-2 last:border-0">
      <span className="font-medium text-foreground">{r.doc_number}</span>
      <Link href={`/purchase/requisitions/${r.id}`} className="text-sm font-medium text-primary hover:text-primary">
        Review
      </Link>
    </div>
  )

  const RowSR = ({ r }: { r: SR }) => (
    <div className="flex items-center justify-between border-b border-border/70 py-2 last:border-0">
      <span className="font-medium text-foreground">{r.doc_number}</span>
      <Link href={`/sales/requisitions/${r.id}`} className="text-sm font-medium text-primary hover:text-primary">
        Review
      </Link>
    </div>
  )

  const empty = <p className="text-sm text-muted-foreground">Nothing here for your roles.</p>

  return (
    <div className="mx-auto w-full min-w-0 max-w-5xl">
      <ReportingHubBreadcrumb current="Requisitions inbox" className="mb-4" />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Requisitions inbox</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Queues depend on your roles (procurement head, sales head, executive, or admin).{' '}
            <button type="button" onClick={() => refetch()} className="font-medium text-primary hover:text-primary">
              {isFetching ? 'Refreshing…' : 'Refresh'}
            </button>
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/purchase/requisitions"
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-foreground/85 shadow-sm hover:bg-muted/40"
          >
            Purchase list
          </Link>
          <Link
            href="/sales/requisitions"
            className="rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-foreground/85 shadow-sm hover:bg-muted/40"
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
