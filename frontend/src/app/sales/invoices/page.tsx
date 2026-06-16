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
    <div className="p-6">
      <ReportingHubBreadcrumb current="Sales invoices" className="mb-4" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sales Invoices</h1>
          <p className="mt-1 text-sm text-gray-600">View posted invoices. Demo seed data is on the Master tenant (domain master).</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/sales/receipts"
            className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            View Receipts
          </Link>
        </div>
      </div>

      {isMounted && (
        <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
          Tenant domain: <span className="font-mono">{tenantDomain}</span>
          {tenantDomain === 'master' ? (
            <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">MASTER</span>
          ) : null}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs font-semibold text-gray-500">Invoices</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">{rows.length}</div>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="text-xs font-semibold text-gray-500">Total</div>
          <div className="mt-2 text-2xl font-bold text-gray-900">{fmtMoney(total)}</div>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search invoice number…"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
        {invoicesQuery.isLoading ? (
          <div className="p-6 text-sm text-gray-600">Loading invoices…</div>
        ) : invoicesQuery.isError ? (
          <div className="p-6">
            <div className="text-sm font-semibold text-red-700">Could not load invoices</div>
            <div className="mt-1 text-sm text-red-600">{(invoicesQuery.error as any)?.message}</div>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <div className="text-sm font-semibold text-gray-900">No invoices found</div>
            <div className="mt-1 text-sm text-gray-600">Seed sales demo data for this tenant or switch tenant/domain.</div>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Invoice</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-500">Status</th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-500">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {rows.map((i) => (
                <tr key={i.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-gray-900">{i.invoice_number}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{(i.status || '').toUpperCase()}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-semibold text-gray-900">{fmtMoney(Number(i.total_amount) || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
