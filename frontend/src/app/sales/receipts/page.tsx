'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDateOnly } from '@/utils/date'

type Receipt = {
  id: number
  receipt_number: string
  customer_id: number
  customer_name?: string | null
  receipt_date?: string | null
  amount: number
  method: string
  ref_invoice_id?: number | null
  ref_invoice_number?: string | null
}

type Customer = { id: number; name: string; is_active?: boolean }

type Invoice = { id: number; invoice_number: string; customer_id: number; total_amount: number; status: string }

function fmtMoney(v: number) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'BDT', maximumFractionDigits: 2 }).format(v)
  } catch {
    return v.toFixed(2)
  }
}

function fmtDate(s?: string | null) {
  return formatDateOnly(s)
}

export default function SalesReceiptsPage() {
  const qc = useQueryClient()
  const [isMounted, setIsMounted] = useState(false)
  const [tenantDomain, setTenantDomain] = useState('localhost')

  const [search, setSearch] = useState('')
  const [methodFilter, setMethodFilter] = useState<'all' | 'cash' | 'bank' | 'cheque'>('all')

  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({
    customer_id: 0,
    receipt_date: new Date().toISOString().slice(0, 10),
    amount: '',
    method: 'cash',
    ref_invoice_id: '' as string,
  })

  useEffect(() => {
    setIsMounted(true)
    setTenantDomain(localStorage.getItem('tenant_domain') || 'localhost')
  }, [])

  const receiptsQuery = useQuery({
    queryKey: ['sales-receipts'],
    queryFn: async () => {
      const res = await api.get<Receipt[]>('/sales/receipts')
      return res.data
    },
    retry: false,
    refetchOnWindowFocus: false,
  })

  const customersQuery = useQuery({
    queryKey: ['customers-basic'],
    queryFn: async () => {
      const res = await api.get<Customer[]>('/customers')
      return res.data
    },
    retry: false,
    refetchOnWindowFocus: false,
  })

  const invoicesQuery = useQuery({
    queryKey: ['sales-invoices-basic'],
    queryFn: async () => {
      const res = await api.get<Invoice[]>('/sales/invoices')
      return res.data
    },
    retry: false,
    refetchOnWindowFocus: false,
  })

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        customer_id: Number(form.customer_id),
        receipt_date: new Date(form.receipt_date).toISOString(),
        amount: Number(form.amount || '0'),
        method: form.method,
        ref_invoice_id: form.ref_invoice_id ? Number(form.ref_invoice_id) : null,
      }
      const res = await api.post('/sales/receipts', payload)
      return res.data
    },
    onSuccess: async () => {
      setShowCreate(false)
      setForm({ customer_id: 0, receipt_date: new Date().toISOString().slice(0, 10), amount: '', method: 'cash', ref_invoice_id: '' })
      await qc.invalidateQueries({ queryKey: ['sales-receipts'] })
    },
  })

  const rows = useMemo(() => {
    const data = receiptsQuery.data || []
    const q = search.trim().toLowerCase()
    return data.filter((r) => {
      const methodOk = methodFilter === 'all' ? true : (r.method || '').toLowerCase() === methodFilter
      if (!methodOk) return false
      if (!q) return true
      return (
        (r.receipt_number || '').toLowerCase().includes(q) ||
        (r.customer_name || '').toLowerCase().includes(q) ||
        (r.ref_invoice_number || '').toLowerCase().includes(q)
      )
    })
  }, [receiptsQuery.data, search, methodFilter])

  const stats = useMemo(() => {
    const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0)
    const cash = rows.filter((r) => (r.method || '').toLowerCase() === 'cash').reduce((s, r) => s + (Number(r.amount) || 0), 0)
    const bank = rows.filter((r) => (r.method || '').toLowerCase() === 'bank').reduce((s, r) => s + (Number(r.amount) || 0), 0)
    return { count: rows.length, total, cash, bank }
  }, [rows])

  const loading = receiptsQuery.isLoading || customersQuery.isLoading || invoicesQuery.isLoading
  const error = (receiptsQuery.error as any)?.message || (customersQuery.error as any)?.message || (invoicesQuery.error as any)?.message

  return (
    <div className="p-6">
      <ReportingHubBreadcrumb current="Sales receipts" className="mb-4" />
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Sales Receipts</h1>
          <p className="mt-1 text-sm text-muted-foreground">Record customer payments and post them to accounting (Cash/Bank → Accounts Receivable).</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/sales/invoices"
            className="inline-flex items-center rounded-md border border-border bg-white px-3 py-2 text-sm font-semibold text-foreground/85 hover:bg-muted/40"
          >
            View Invoices
          </Link>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90"
          >
            New Receipt
          </button>
        </div>
      </div>

      {isMounted && (
        <div className="mt-4 rounded-lg border border-border bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-foreground/85">
              Tenant domain: <span className="font-mono">{tenantDomain}</span>
              {tenantDomain === 'master' ? (
                <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-warning-foreground">MASTER</span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => receiptsQuery.refetch()}
                className="inline-flex items-center rounded-md border border-border bg-white px-3 py-2 text-xs font-semibold text-foreground/85 hover:bg-muted/40"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-white p-4">
          <div className="text-xs font-semibold text-muted-foreground">Receipts</div>
          <div className="mt-2 text-2xl font-bold text-foreground">{stats.count}</div>
        </div>
        <div className="rounded-lg border border-border bg-white p-4">
          <div className="text-xs font-semibold text-muted-foreground">Total Collected</div>
          <div className="mt-2 text-2xl font-bold text-foreground">{fmtMoney(stats.total)}</div>
        </div>
        <div className="rounded-lg border border-border bg-white p-4">
          <div className="text-xs font-semibold text-muted-foreground">Cash</div>
          <div className="mt-2 text-2xl font-bold text-foreground">{fmtMoney(stats.cash)}</div>
        </div>
        <div className="rounded-lg border border-border bg-white p-4">
          <div className="text-xs font-semibold text-muted-foreground">Bank</div>
          <div className="mt-2 text-2xl font-bold text-foreground">{fmtMoney(stats.bank)}</div>
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-border bg-white p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search receipt no / customer / invoice…"
              className="w-full rounded-md border border-border px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>
          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value as any)}
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            <option value="all">All methods</option>
            <option value="cash">Cash</option>
            <option value="bank">Bank</option>
            <option value="cheque">Cheque</option>
          </select>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-lg border border-border bg-white">
        {loading ? (
          <div className="p-6 text-sm text-muted-foreground">Loading receipts…</div>
        ) : error ? (
          <div className="p-6">
            <div className="text-sm font-semibold text-destructive">Could not load receipts</div>
            <div className="mt-1 text-sm text-destructive">{error}</div>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <div className="text-sm font-semibold text-foreground">No receipts found</div>
            <div className="mt-1 text-sm text-muted-foreground">Create a receipt or switch tenant mode/domain.</div>
          </div>
        ) : (
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Receipt</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Date</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Customer</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Method</th>
                <th className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Invoice</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-muted/40">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-foreground">{r.receipt_number}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground/85">{fmtDate(r.receipt_date)}</td>
                  <td className="px-6 py-4 text-sm text-foreground/85">{r.customer_name || `Customer #${r.customer_id}`}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-foreground">
                      {(r.method || '').toUpperCase()}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-semibold text-foreground">{fmtMoney(Number(r.amount) || 0)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground/85">{r.ref_invoice_number || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-xl rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b px-5 py-4">
              <div>
                <div className="text-lg font-bold text-foreground">New Receipt</div>
                <div className="text-sm text-muted-foreground">Creates a receipt and posts Cash/Bank → AR.</div>
              </div>
              <button onClick={() => setShowCreate(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>

            <div className="px-5 py-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Customer</label>
                  <select
                    value={form.customer_id}
                    onChange={(e) => setForm((f) => ({ ...f, customer_id: Number(e.target.value) }))}
                    className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <option value={0}>Select customer…</option>
                    {(customersQuery.data || []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Receipt date</label>
                  <input
                    type="date"
                    value={form.receipt_date}
                    onChange={(e) => setForm((f) => ({ ...f, receipt_date: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Amount</label>
                  <input
                    value={form.amount}
                    onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                    placeholder="0.00"
                    className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground">Method</label>
                  <select
                    value={form.method}
                    onChange={(e) => setForm((f) => ({ ...f, method: e.target.value }))}
                    className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  >
                    <option value="cash">Cash</option>
                    <option value="bank">Bank</option>
                    <option value="cheque">Cheque</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground">Apply to invoice (optional)</label>
                <select
                  value={form.ref_invoice_id}
                  onChange={(e) => setForm((f) => ({ ...f, ref_invoice_id: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                >
                  <option value="">No invoice</option>
                  {(invoicesQuery.data || []).map((i) => (
                    <option key={i.id} value={String(i.id)}>
                      {i.invoice_number} (Customer #{i.customer_id})
                    </option>
                  ))}
                </select>
                <div className="mt-1 text-xs text-muted-foreground">This is a reference link only (does not yet auto-reconcile invoice balances).</div>
              </div>

              {createMutation.isError ? (
                <div className="rounded-md border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
                  {(createMutation.error as any)?.response?.data?.detail || (createMutation.error as any)?.message || 'Failed to create receipt'}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t px-5 py-4">
              <button
                onClick={() => setShowCreate(false)}
                className="rounded-md border border-border bg-white px-3 py-2 text-sm font-semibold text-foreground/85 hover:bg-muted/40"
              >
                Cancel
              </button>
              <button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !form.customer_id || Number(form.amount || '0') <= 0}
                className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {createMutation.isPending ? 'Creating…' : 'Create Receipt'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
