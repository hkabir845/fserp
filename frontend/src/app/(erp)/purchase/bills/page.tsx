'use client'

import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { formatDateOnly } from '@/utils/date'

type VendorBillRow = {
  id: number
  bill_number: string
  supplier_id: number
  supplier_name: string
  status: string
  bill_date: string
  due_date: string | null
  total_amount: number
  ref_grn_id: number | null
  line_count: number
}

type SupplierOpt = { id: number; name: string }
type ItemOpt = { id: number; sku: string; name: string }

export default function PurchaseBillsPage() {
  const queryClient = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({
    supplier_id: '' as number | '',
    bill_date: new Date().toISOString().slice(0, 10),
    due_date: '' as string,
    lines: [{ item_id: '' as number | '', qty: '1', unit_price: '0' }],
  })

  const { data: bills = [], isLoading, isError, error, refetch } = useQuery<VendorBillRow[]>({
    queryKey: ['vendor-bills'],
    queryFn: async () => (await api.get('/purchase/vendor-bills')).data,
  })

  const { data: suppliers = [] } = useQuery<SupplierOpt[]>({
    queryKey: ['suppliers-bills'],
    queryFn: async () => (await api.get('/suppliers')).data,
  })

  const { data: items = [] } = useQuery<ItemOpt[]>({
    queryKey: ['items-bills'],
    queryFn: async () => (await api.get('/items?limit=500&include_inactive=false')).data,
  })

  const supplierMap = useMemo(
    () => Object.fromEntries(suppliers.map((s) => [s.id, s.name])),
    [suppliers],
  )

  const seedMutation = useMutation({
    mutationFn: () => api.post('/purchase/vendor-bills/seed-demo'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-bills'] })
    },
  })

  const createMutation = useMutation({
    mutationFn: async (payload: {
      supplier_id: number
      bill_date: string
      due_date: string | null
      lines: { item_id: number; qty: number; unit_price: number }[]
    }) => api.post('/purchase/vendor-bills', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vendor-bills'] })
      setShowCreate(false)
      setForm({
        supplier_id: '',
        bill_date: new Date().toISOString().slice(0, 10),
        due_date: '',
        lines: [{ item_id: '', qty: '1', unit_price: '0' }],
      })
    },
  })

  const submitCreate = () => {
    const sid = Number(form.supplier_id)
    if (!sid) {
      alert('Choose a supplier.')
      return
    }
    const lines = form.lines
      .map((l) => ({
        item_id: Number(l.item_id),
        qty: Number(l.qty),
        unit_price: Number(l.unit_price),
      }))
      .filter((l) => l.item_id && l.qty > 0 && l.unit_price >= 0)
    if (!lines.length) {
      alert('Add at least one line with item, qty, and unit price.')
      return
    }
    const bill_date = new Date(form.bill_date + 'T12:00:00').toISOString()
    const due_date = form.due_date
      ? new Date(form.due_date + 'T12:00:00').toISOString()
      : null
    createMutation.mutate({ supplier_id: sid, bill_date, due_date, lines })
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <ReportingHubBreadcrumb current="Vendor bills" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Vendor bills</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Accounts payable invoices from suppliers. Posting uses Inventory (or GRNI if linked to a GRN) vs Accounts Payable.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            className="rounded-md border border-border bg-white px-3 py-2 text-sm font-medium text-foreground/85 hover:bg-muted/40"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => seedMutation.mutate()}
            disabled={seedMutation.isPending}
            className="rounded-md border border-amber-300 bg-warning/10 px-3 py-2 text-sm font-medium text-warning-foreground hover:bg-amber-100 disabled:opacity-50"
          >
            {seedMutation.isPending ? 'Creating…' : 'Create sample bills (3)'}
          </button>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/90"
          >
            New vendor bill
          </button>
        </div>
      </div>

      {seedMutation.isError && (
        <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
          {(seedMutation.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
            'Could not create sample bills. Ensure GL accounts (AP, Inventory) and at least one supplier + item exist.'}
        </div>
      )}

      {(isError || createMutation.isError) && (
        <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive">
          {(error as Error)?.message ||
            (createMutation.error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
            'Request failed'}
        </div>
      )}

      <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">Bill #</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">Supplier</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">Date</th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-muted-foreground">Amount</th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase text-muted-foreground">Lines</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">GRN</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-white">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              ) : bills.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No vendor bills yet. Use <strong>Create sample bills (3)</strong> or <strong>New vendor bill</strong>.
                  </td>
                </tr>
              ) : (
                bills.map((b) => (
                  <tr key={b.id} className="hover:bg-muted/40">
                    <td className="px-4 py-3 text-sm font-mono text-foreground">{b.bill_number}</td>
                    <td className="px-4 py-3 text-sm text-foreground">{b.supplier_name || supplierMap[b.supplier_id] || '—'}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {b.bill_date ? formatDateOnly(b.bill_date) : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-foreground">
                      {b.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-sm text-center text-muted-foreground">{b.line_count}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{b.ref_grn_id ?? '—'}</td>
                    <td className="px-4 py-3 text-sm">
                      <span
                        className={
                          b.status === 'posted'
                            ? 'rounded-full bg-success/15 px-2 py-0.5 text-success'
                            : 'rounded-full bg-muted px-2 py-0.5 text-foreground'
                        }
                      >
                        {b.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-semibold text-foreground">New vendor bill</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Direct expense to Inventory (no GRN). Requires GL accounts from accounting seed.
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-sm font-medium text-foreground/85">Supplier</label>
                <select
                  className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                  value={form.supplier_id === '' ? '' : form.supplier_id}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, supplier_id: e.target.value ? Number(e.target.value) : '' }))
                  }
                >
                  <option value="">Select…</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-foreground/85">Bill date</label>
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                    value={form.bill_date}
                    onChange={(e) => setForm((f) => ({ ...f, bill_date: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground/85">Due date (optional)</label>
                  <input
                    type="date"
                    className="mt-1 w-full rounded-md border border-border px-3 py-2 text-sm"
                    value={form.due_date}
                    onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/85">Lines</label>
                <div className="mt-2 space-y-2">
                  {form.lines.map((line, idx) => (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                      <div className="col-span-5">
                        {idx === 0 && <span className="text-xs text-muted-foreground">Item</span>}
                        <select
                          className="mt-0.5 w-full rounded-md border border-border px-2 py-1.5 text-xs"
                          value={line.item_id === '' ? '' : line.item_id}
                          onChange={(e) => {
                            const v = e.target.value ? Number(e.target.value) : ''
                            setForm((f) => {
                              const lines = [...f.lines]
                              lines[idx] = { ...lines[idx], item_id: v }
                              return { ...f, lines }
                            })
                          }}
                        >
                          <option value="">Item…</option>
                          {items.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.sku} — {it.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-3">
                        {idx === 0 && <span className="text-xs text-muted-foreground">Qty</span>}
                        <input
                          className="mt-0.5 w-full rounded-md border border-border px-2 py-1.5 text-xs"
                          inputMode="decimal"
                          value={line.qty}
                          onChange={(e) => {
                            const q = e.target.value
                            setForm((f) => {
                              const lines = [...f.lines]
                              lines[idx] = { ...lines[idx], qty: q }
                              return { ...f, lines }
                            })
                          }}
                        />
                      </div>
                      <div className="col-span-3">
                        {idx === 0 && <span className="text-xs text-muted-foreground">Unit price</span>}
                        <input
                          className="mt-0.5 w-full rounded-md border border-border px-2 py-1.5 text-xs"
                          inputMode="decimal"
                          value={line.unit_price}
                          onChange={(e) => {
                            const q = e.target.value
                            setForm((f) => {
                              const lines = [...f.lines]
                              lines[idx] = { ...lines[idx], unit_price: q }
                              return { ...f, lines }
                            })
                          }}
                        />
                      </div>
                      <div className="col-span-1 pb-1">
                        {form.lines.length > 1 && (
                          <button
                            type="button"
                            className="text-xs text-destructive"
                            onClick={() =>
                              setForm((f) => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }))
                            }
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="mt-2 text-sm text-primary"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      lines: [...f.lines, { item_id: '', qty: '1', unit_price: '0' }],
                    }))
                  }
                >
                  + Add line
                </button>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-border px-4 py-2 text-sm"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={createMutation.isPending}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-50"
                onClick={submitCreate}
              >
                {createMutation.isPending ? 'Saving…' : 'Create & post'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
