'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ReportingHubBreadcrumb } from '@/components/ReportingHubBreadcrumb'
import {
  downloadCsvFile,
  formatPrintDateTime,
  safeFilenameSegment,
  toCsvText,
} from '@/lib/printAndExport'
import { formatDateOnly } from '@/utils/date'

interface Supplier {
  id: number
  name: string
  phone?: string | null
  email?: string | null
  address?: string | null
  gstin?: string | null
  bank_name?: string | null
  bank_account_no?: string | null
  bank_branch?: string | null
  bank_routing_or_ifsc?: string | null
  opening_balance?: number
  opening_balance_as_of?: string | null
  gl_account_id?: number | null
  gl_account_code?: string | null
  ledger_balance?: number | null
  is_active: boolean
}

export default function SuppliersPage() {
  const qc = useQueryClient()

  const [tenantDomain, setTenantDomain] = useState<string>('localhost')
  const [includeInactive, setIncludeInactive] = useState(false)
  const [q, setQ] = useState('')

  const [viewing, setViewing] = useState<Supplier | null>(null)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [showCreate, setShowCreate] = useState(false)

  useEffect(() => {
    setTenantDomain(localStorage.getItem('tenant_domain') || 'localhost')
  }, [])

  const { data: suppliers = [], isLoading, isError, error, refetch } = useQuery<Supplier[]>({
    queryKey: ['suppliers', includeInactive],
    queryFn: async () => {
      const res = await api.get('/suppliers', { params: { include_inactive: includeInactive } })
      return res.data || []
    },
    retry: false,
    refetchOnWindowFocus: false,
  })

  const filtered = useMemo(() => {
    const qn = q.trim().toLowerCase()
    if (!qn) return suppliers
    return suppliers.filter((s) => {
      const hay = `${s.name} ${s.phone || ''} ${s.email || ''} ${s.gstin || ''}`.toLowerCase()
      return hay.includes(qn)
    })
  }, [suppliers, q])

  const stats = useMemo(() => {
    const total = suppliers.length
    const active = suppliers.filter((s) => s.is_active).length
    const inactive = total - active
    return { total, active, inactive }
  }, [suppliers])

  const createMutation = useMutation({
    mutationFn: async (payload: Partial<Supplier>) => {
      const res = await api.post('/suppliers', payload)
      return res.data
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['suppliers'] })
      setShowCreate(false)
    },
  })

  const updateMutation = useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: Partial<Supplier> }) => {
      const res = await api.patch(`/suppliers/${id}`, payload)
      return res.data
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['suppliers'] })
      setEditing(null)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.delete(`/suppliers/${id}`)
      return res.data
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['suppliers'] })
    },
  })

  const restoreMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await api.patch(`/suppliers/${id}`, { is_active: true })
      return res.data
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['suppliers'] })
    },
  })

  const errorMsg = useMemo(() => {
    const e: any = error
    return e?.response?.data?.detail || e?.message || 'Failed to load suppliers.'
  }, [error])

  const exportCsv = () => {
    const header = [
      'id',
      'name',
      'address',
      'phone',
      'email',
      'gstin',
      'opening_balance',
      'opening_balance_as_of',
      'gl_account_code',
      'ledger_balance',
      'status',
    ]
    const dataRows: unknown[][] = filtered.map((s) => [
      s.id,
      s.name,
      s.address || '',
      s.phone || '',
      s.email || '',
      s.gstin || '',
      s.opening_balance ?? 0,
      s.opening_balance_as_of || '',
      s.gl_account_code || '',
      s.ledger_balance ?? '',
      s.is_active ? 'Active' : 'Inactive',
    ])
    const fn = `suppliers_${safeFilenameSegment(tenantDomain)}_${new Date().toISOString().slice(0, 10)}.csv`
    downloadCsvFile(fn, toCsvText(header, dataRows))
  }

  return (
    <>
      <div className="h-full flex flex-col overflow-hidden">
        <div
          className="hidden print:block print:mb-4 print:border-b print:pb-3 print:border-border"
          aria-hidden="true"
        >
          <div className="text-xl font-bold text-foreground">Supplier list</div>
          <div className="text-sm text-muted-foreground">
            Company: {tenantDomain} · Printed {formatPrintDateTime()} · Rows: {filtered.length}
            {q.trim() ? ` (search: "${q.trim()}")` : ''}
            {includeInactive ? ' · including inactive' : ''}
          </div>
        </div>

        <div className="h-full print:h-auto flex flex-col overflow-hidden">
        <div className="flex-shrink-0 space-y-4 pb-4 print:space-y-2 print:pb-0">
          <ReportingHubBreadcrumb current="Suppliers" className="print:hidden" />
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 print:hidden">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Suppliers</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Manage supplier master data for purchasing and payables.</p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-2 bg-white border border-border rounded-md text-sm font-medium text-foreground/85 hover:bg-muted/40"
              >
                Print
              </button>
              <button
                type="button"
                onClick={exportCsv}
                className="px-4 py-2 bg-white border border-border rounded-md text-sm font-medium text-foreground/85 hover:bg-muted/40"
              >
                Export CSV
              </button>
              <button
                type="button"
                onClick={() => refetch()}
                className="px-4 py-2 bg-white border border-border rounded-md text-sm font-medium text-foreground/85 hover:bg-muted/40"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 flex items-center gap-2"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Supplier
              </button>
            </div>
          </div>

          {tenantDomain === 'master' && (
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-4 print:hidden">
              <div className="text-sm font-semibold text-warning-foreground">Master Company (demo tenant)</div>
              <div className="mt-1 text-sm text-warning-foreground">
                Sample suppliers from seed scripts are stored on this tenant. Other tenants stay empty until you add data.
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 print:hidden">
            <Stat title="Total" value={stats.total} accent="border-indigo-500" />
            <Stat title="Active" value={stats.active} accent="border-green-500" />
            <Stat title="Inactive" value={stats.inactive} accent="border-border/500" />
          </div>

          <div className="bg-white rounded-lg shadow p-3 print:hidden">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-foreground/85 mb-1">Search</label>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search by name, phone, email, GSTIN…"
                  className="w-full px-3 py-2 border border-border rounded-md focus:ring-ring focus:border-ring"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="include_inactive"
                  type="checkbox"
                  checked={includeInactive}
                  onChange={(e) => setIncludeInactive(e.target.checked)}
                  className="h-4 w-4 rounded border-border text-primary"
                />
                <label htmlFor="include_inactive" className="text-sm font-medium text-foreground/85">
                  Include inactive
                </label>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow overflow-hidden print:shadow-none print:border print:border-border">
            {isLoading ? (
              <div className="p-10 text-center print:hidden">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                <div className="mt-3 text-sm text-muted-foreground">Loading suppliers…</div>
              </div>
            ) : isError ? (
              <div className="p-6 print:hidden">
                <div className="rounded-md border border-destructive/25 bg-destructive/5 p-4">
                  <div className="text-sm font-semibold text-destructive">Could not load suppliers</div>
                  <div className="mt-1 text-sm text-destructive">{errorMsg}</div>
                  <button
                    type="button"
                    onClick={() => refetch()}
                    className="mt-3 inline-flex items-center rounded-md border border-destructive/30 bg-white px-3 py-2 text-sm font-semibold text-destructive hover:bg-destructive/5"
                  >
                    Try again
                  </button>
                </div>
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-10 text-center print:hidden">
                <div className="text-lg font-semibold text-foreground">No suppliers found</div>
                <div className="mt-2 text-sm text-muted-foreground">Create a supplier or adjust your filters.</div>
              </div>
            ) : (
              <div className="overflow-x-auto print:overflow-visible">
                <table className="min-w-full divide-y divide-border text-sm print:text-xs print:[&_th]:p-2 print:[&_td]:p-2">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Name</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Contact</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">GSTIN</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">GL</th>
                      <th className="px-6 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">Ledger</th>
                      <th className="px-6 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider print:hidden">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-border">
                    {filtered.map((s) => (
                      <tr key={s.id} className="hover:bg-muted/40">
                        <td className="px-6 py-4">
                          <div className="text-sm font-semibold text-foreground">{s.name}</div>
                          <div className="text-xs text-muted-foreground">{s.address || '-'}</div>
                        </td>
                        <td className="px-6 py-4">
                          <div className="text-sm text-foreground">{s.phone || '-'}</div>
                          <div className="text-xs text-muted-foreground">{s.email || '-'}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-foreground">{s.gstin || '-'}</td>
                        <td className="px-6 py-4 text-xs font-mono text-foreground">{s.gl_account_code || '—'}</td>
                        <td className="px-6 py-4 whitespace-nowrap text-right tabular-nums text-sm text-foreground">
                          {s.ledger_balance != null
                            ? new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
                                s.ledger_balance
                              )
                            : '—'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${
                              s.is_active
                                ? 'bg-success/15 text-success border-success/25'
                                : 'bg-muted text-foreground border-border'
                            }`}
                          >
                            {s.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right print:hidden">
                          <div className="inline-flex items-center gap-1">
                            <button
                              onClick={() => setViewing(s)}
                              className="text-muted-foreground hover:text-foreground p-1"
                              title="View"
                            >
                              <EyeIcon />
                            </button>
                            <button
                              onClick={() => setEditing(s)}
                              className="text-primary hover:text-foreground/85 p-1"
                              title="Edit"
                            >
                              <EditIcon />
                            </button>
                            {s.is_active ? (
                              <button
                                onClick={() => {
                                  if (confirm(`Delete supplier: ${s.name}? (You can restore later)`)) {
                                    deleteMutation.mutate(s.id)
                                  }
                                }}
                                className="text-destructive hover:text-red-900 p-1"
                                title="Delete"
                              >
                                <TrashIcon />
                              </button>
                            ) : (
                              <button
                                onClick={() => restoreMutation.mutate(s.id)}
                                className="text-emerald-600 hover:text-emerald-900 p-1"
                                title="Restore"
                              >
                                <RestoreIcon />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        </div>
      </div>

      {(showCreate || viewing || editing) && (
        <div className="fixed inset-0 bg-muted-foreground bg-opacity-50 overflow-y-auto h-full w-full z-50 print:hidden">
          <SupplierModal
            mode={viewing ? 'view' : editing ? 'edit' : 'create'}
            supplier={viewing || editing}
            isSaving={createMutation.isPending || updateMutation.isPending}
            errorMsg={
              (createMutation.error as any)?.response?.data?.detail ||
              (updateMutation.error as any)?.response?.data?.detail ||
              (createMutation.error as any)?.message ||
              (updateMutation.error as any)?.message ||
              undefined
            }
            onClose={() => {
              setShowCreate(false)
              setViewing(null)
              setEditing(null)
            }}
            onCreate={(payload) => createMutation.mutate(payload)}
            onUpdate={(id, payload) => updateMutation.mutate({ id, payload })}
          />
        </div>
      )}
    </>
  )
}

function Stat({ title, value, accent }: { title: string; value: number; accent: string }) {
  return (
    <div className={`bg-white rounded-lg shadow p-6 border-l-4 ${accent}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-3xl font-bold text-foreground mt-2">{value}</p>
        </div>
        <div className="bg-accent rounded-full p-3">
          <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0" />
          </svg>
        </div>
      </div>
    </div>
  )
}

function SupplierModal({
  mode,
  supplier,
  onClose,
  onCreate,
  onUpdate,
  isSaving,
  errorMsg,
}: {
  mode: 'create' | 'edit' | 'view'
  supplier: Supplier | null
  onClose: () => void
  onCreate: (payload: Record<string, unknown>) => void
  onUpdate: (id: number, payload: Record<string, unknown>) => void
  isSaving: boolean
  errorMsg?: string
}) {
  const [form, setForm] = useState({
    name: supplier?.name || '',
    phone: supplier?.phone || '',
    email: supplier?.email || '',
    address: supplier?.address || '',
    gstin: supplier?.gstin || '',
    bank_name: supplier?.bank_name || '',
    bank_account_no: supplier?.bank_account_no || '',
    bank_branch: supplier?.bank_branch || '',
    bank_routing_or_ifsc: supplier?.bank_routing_or_ifsc || '',
    opening_balance: supplier?.opening_balance ?? 0,
    opening_balance_as_of: supplier?.opening_balance_as_of
      ? supplier.opening_balance_as_of.slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    is_active: supplier?.is_active ?? true,
  })

  const canSave = mode !== 'view' && Boolean(form.name.trim())

  const fmtMoney = (n: number | null | undefined) =>
    new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      Number(n ?? 0)
    )

  const save = () => {
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      gstin: form.gstin.trim() || null,
      bank_name: form.bank_name.trim() || null,
      bank_account_no: form.bank_account_no.trim() || null,
      bank_branch: form.bank_branch.trim() || null,
      bank_routing_or_ifsc: form.bank_routing_or_ifsc.trim() || null,
    }

    if (mode === 'create') {
      payload.opening_balance = Number(form.opening_balance) || 0
      if (payload.opening_balance !== 0) {
        payload.opening_balance_as_of = new Date(form.opening_balance_as_of + 'T12:00:00').toISOString()
      }
      onCreate(payload)
      return
    }

    if (!supplier) return
    onUpdate(supplier.id, { ...payload, is_active: form.is_active })
  }

  return (
    <div className="relative top-16 mx-auto w-[52rem] max-w-[96vw] max-h-[90vh] overflow-y-auto shadow-lg rounded-xl bg-white border border-border">
      <div className="p-6 border-b border-border flex items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            {mode === 'create' ? 'Create supplier' : mode === 'edit' ? 'Edit supplier' : 'View supplier'}
          </h3>
          <p className="text-sm text-muted-foreground mt-1">Supplier master data used across Purchase Orders, GRN, and Payables.</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border bg-white px-3 py-2 text-sm font-medium text-foreground/85 hover:bg-muted/40"
        >
          Close
        </button>
      </div>

      <div className="p-6 space-y-4">
        {errorMsg && <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">{errorMsg}</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-foreground/85 mb-1">Name *</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              disabled={mode === 'view'}
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
              placeholder="e.g. Agro Feed Traders"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground/85 mb-1">Phone</label>
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              disabled={mode === 'view'}
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
              placeholder="+880-..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground/85 mb-1">Email</label>
            <input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              disabled={mode === 'view'}
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
              placeholder="accounts@supplier.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground/85 mb-1">GSTIN</label>
            <input
              value={form.gstin}
              onChange={(e) => setForm({ ...form, gstin: e.target.value })}
              disabled={mode === 'view'}
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
              placeholder="GSTIN..."
            />
          </div>

          <div className="md:col-span-2 border-t border-border/70 pt-4 mt-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Bank details</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">Bank name</label>
                <input
                  value={form.bank_name}
                  onChange={(e) => setForm({ ...form, bank_name: e.target.value })}
                  disabled={mode === 'view'}
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">Account number</label>
                <input
                  value={form.bank_account_no}
                  onChange={(e) => setForm({ ...form, bank_account_no: e.target.value })}
                  disabled={mode === 'view'}
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">Branch</label>
                <input
                  value={form.bank_branch}
                  onChange={(e) => setForm({ ...form, bank_branch: e.target.value })}
                  disabled={mode === 'view'}
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground/85 mb-1">Routing / IFSC / IBAN</label>
                <input
                  value={form.bank_routing_or_ifsc}
                  onChange={(e) => setForm({ ...form, bank_routing_or_ifsc: e.target.value })}
                  disabled={mode === 'view'}
                  className="w-full rounded-md border border-border px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>

          {mode === 'create' && (
            <div className="md:col-span-2 border-t border-border/70 pt-4 mt-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Opening balance (GL)</p>
              <p className="text-xs text-muted-foreground mb-3">
                Positive = amount you owe this supplier (A/P). Negative = prepayment. Offsets Retained earnings (3200).
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-foreground/85 mb-1">As-of balance</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.opening_balance}
                    onChange={(e) => setForm({ ...form, opening_balance: parseFloat(e.target.value) || 0 })}
                    className="w-full rounded-md border border-border px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground/85 mb-1">Effective date</label>
                  <input
                    type="date"
                    value={form.opening_balance_as_of}
                    onChange={(e) => setForm({ ...form, opening_balance_as_of: e.target.value })}
                    className="w-full rounded-md border border-border px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          {(mode === 'view' || mode === 'edit') && supplier && (
            <div className="md:col-span-2 rounded-lg border border-primary/15 bg-accent/50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-primary mb-2">Sub-ledger</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">GL account: </span>
                  <span className="font-mono font-medium text-foreground">{supplier.gl_account_code || '—'}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Current balance: </span>
                  <span className="font-medium tabular-nums text-foreground">
                    {supplier.ledger_balance != null ? fmtMoney(supplier.ledger_balance) : '—'}
                  </span>
                </div>
                <div className="sm:col-span-2 text-xs text-muted-foreground">
                  Opening at create: {fmtMoney(supplier.opening_balance ?? 0)}
                  {supplier.opening_balance_as_of
                    ? ` · ${formatDateOnly(supplier.opening_balance_as_of)}`
                    : ''}
                </div>
              </div>
            </div>
          )}

          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-foreground/85 mb-1">Address / Notes</label>
            <textarea
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              disabled={mode === 'view'}
              className="w-full rounded-md border border-border px-3 py-2 text-sm"
              rows={4}
              placeholder="Billing address, payment method/terms, etc."
            />
          </div>

          {mode === 'edit' && (
            <div className="flex items-center gap-2">
              <input
                id="is_active"
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                className="h-4 w-4 rounded border-border text-primary"
              />
              <label htmlFor="is_active" className="text-sm font-medium text-foreground/85">
                Active
              </label>
            </div>
          )}
        </div>
      </div>

      <div className="p-6 border-t border-border flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border bg-white px-4 py-2 text-sm font-semibold text-foreground/85 hover:bg-muted/40"
        >
          Cancel
        </button>
        {mode !== 'view' && (
          <button
            type="button"
            onClick={save}
            disabled={!canSave || isSaving}
            className="erp-btn-primary rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : mode === 'create' ? 'Create supplier' : 'Save changes'}
          </button>
        )}
      </div>
    </div>
  )
}

function EyeIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
      />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
      />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  )
}

function RestoreIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3 12a9 9 0 0115.364-6.364L21 8m0 0v-5m0 5h-5M21 12a9 9 0 01-15.364 6.364L3 16m0 0v5m0-5h5"
      />
    </svg>
  )
}
