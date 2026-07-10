'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

type Invoice = {
  id: number
  invoice_number: string
  customer_id: number
  status: string
  total_amount: number
}

function fmtMoney(v: number) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'BDT', maximumFractionDigits: 2 }).format(v)
  } catch {
    return v.toFixed(2)
  }
}

export default function SalesInvoicesPage() {
  const [isMounted, setIsMounted] = useState(false)
  const [tenantDomain, setTenantDomain] = useState('localhost')
  const [search, setSearch] = useState('')

  useEffect(() => {
    setIsMounted(true)
    setTenantDomain(localStorage.getItem('tenant_domain') || 'localhost')
  }, [])

  const invoicesQuery = useQuery({
    queryKey: ['sales-invoices'],
    queryFn: async () => {
      const res = await api.get<Invoice[]>('/sales/invoices')
      return res.data
    },
    retry: false,
    refetchOnWindowFocus: false,
  })

  const rows = useMemo(() => {
    const data = invoicesQuery.data || []
    const q = search.trim().toLowerCase()
    if (!q) return data
    return data.filter((i) => (i.invoice_number || '').toLowerCase().includes(q))
  }, [invoicesQuery.data, search])

  const total = useMemo(() => rows.reduce((s, r) => s + (Number(r.total_amount) || 0), 0), [rows])

  return (
    <div>
      <ReportingHubBreadcrumb current="Sales invoices" className="mb-4" />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Sales Invoices</h1>
          <p className="mt-1 text-sm text-muted-foreground">View posted invoices. Demo seed data is on the Master tenant (domain master).</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/sales/receipts"
            className="inline-flex items-center rounded-md border border-border bg-white px-3 py-2 text-sm font-semibold text-foreground/85 hover:bg-muted/40"
          >
            View Receipts
          </Link>
        </div>
      </div>

      {isMounted && (
        <div className="mt-4 rounded-lg border border-border bg-white p-4 text-sm text-foreground/85">
          Tenant domain: <span className="font-mono">{tenantDomain}</span>
          {tenantDomain === 'master' ? (
            <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-warning-foreground">MASTER</span>
          ) : null}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-white p-4">
          <div className="text-xs font-semibold text-muted-foreground">Invoices</div>
          <div className="mt-2 text-2xl font-bold text-foreground">{rows.length}</div>
        </div>
        <div className="rounded-lg border border-border bg-white p-4">
          <div className="text-xs font-semibold text-muted-foreground">Total</div>
          <div className="mt-2 text-2xl font-bold text-foreground">{fmtMoney(total)}</div>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-border bg-white p-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search invoice number…"
          className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border bg-white">
        {invoicesQuery.isLoading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading invoices…</div>
        ) : invoicesQuery.isError ? (
          <div className="p-6">
            <div className="text-sm font-semibold text-destructive">Could not load invoices</div>
            <div className="mt-1 text-sm text-destructive">{(invoicesQuery.error as any)?.message}</div>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <div className="text-sm font-semibold text-foreground">No invoices found</div>
            <div className="mt-1 text-sm text-muted-foreground">Seed sales demo data for this tenant or switch tenant/domain.</div>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Invoice</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white">
              {rows.map((i) => (
                <tr key={i.id} className="hover:bg-muted/40">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-foreground">{i.invoice_number}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground/85">{(i.status || '').toUpperCase()}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-semibold text-foreground">{fmtMoney(Number(i.total_amount) || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
