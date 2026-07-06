'use client'

import { CompanyDateInput } from '@/components/CompanyDateInput'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import PageLayout from '@/components/PageLayout'
import { ErpPageShell } from '@/components/aquaculture/ErpPageShell'
import { usePageMeta } from '@/hooks/usePageMeta'
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Percent,
  FileText,
  Building2,
  RefreshCw,
  Search,
  CalendarRange,
} from 'lucide-react'
import { useToast } from '@/components/Toast'
import api, { getBackendOrigin } from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'
import { isConnectionError } from '@/utils/connectionError'
import { formatNumber } from '@/utils/currency'

/** Matches Django `tax_views._tax_to_json` */
interface TaxRateRow {
  id: number
  rate: string
  effective_from: string | null
  effective_to: string | null
}

interface Tax {
  id: number
  name: string
  description: string
  is_active: boolean
  rates: TaxRateRow[]
}

function inferTaxKind(name: string): { label: string; className: string } {
  const n = name.toUpperCase()
  if (n.includes('VAT') || n.includes('VALUE ADDED')) {
    return { label: 'VAT', className: 'bg-blue-100 text-primary ring-1 ring-blue-200/60' }
  }
  if (n.includes('SUPPLEMENTARY') || /\bSD\b/.test(n) || n.includes('PETROL') || n.includes('DIESEL')) {
    return { label: 'SD', className: 'bg-violet-100 text-violet-800 ring-1 ring-violet-200/60' }
  }
  if (n.includes('AIT') || n.includes('ADVANCE INCOME')) {
    return { label: 'AIT', className: 'bg-amber-100 text-warning-foreground ring-1 ring-amber-200/60' }
  }
  return { label: 'Tax', className: 'bg-muted text-foreground/85 ring-1 ring-border/60' }
}

const BD_PRESETS = [
  {
    name: 'VAT',
    description: 'Value Added Tax — standard fuel sales (Bangladesh VAT Act 2012).',
    defaultRate: '15.00',
  },
  {
    name: 'SD — Petrol / Octane',
    description: 'Supplementary duty reference for petrol/octane (verify current NBR circular).',
    defaultRate: '37.00',
  },
  {
    name: 'SD — Diesel',
    description: 'Supplementary duty reference for diesel (verify current NBR circular).',
    defaultRate: '20.00',
  },
  {
    name: 'AIT',
    description: 'Advance Income Tax where applicable (Income Tax Ordinance 1984).',
    defaultRate: '3.00',
  },
] as const

export default function TaxPage() {
  const router = useRouter()
  const toast = useToast()
  const pageMeta = usePageMeta()
  const [taxes, setTaxes] = useState<Tax[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showRateModal, setShowRateModal] = useState(false)
  const [rateTargetTaxId, setRateTargetTaxId] = useState<number | null>(null)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [selectedPreset, setSelectedPreset] = useState<string>('')
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    is_active: true,
  })
  const [rateForm, setRateForm] = useState({
    rate: '',
    effective_from: '',
    effective_to: '',
  })

  const canManageTax = useMemo(() => {
    const r = (userRole || '').toLowerCase()
    return ['admin', 'super_admin', 'accountant', 'manager'].includes(r)
  }, [userRole])

  const canInitBangladesh = useMemo(() => {
    const r = (userRole || '').toLowerCase()
    return ['admin', 'super_admin'].includes(r)
  }, [userRole])

  const canHardDelete = useMemo(() => {
    const r = (userRole || '').toLowerCase()
    return ['admin', 'super_admin'].includes(r)
  }, [userRole])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    const userStr = localStorage.getItem('user')
    if (userStr && userStr !== 'undefined' && userStr !== 'null') {
      try {
        const user = JSON.parse(userStr)
        setUserRole(typeof user.role === 'string' ? user.role.toLowerCase() : null)
      } catch {
        setUserRole(null)
      }
    }
    fetchTaxes()
  }, [router])

  const fetchTaxes = async () => {
    try {
      setLoading(true)
      const response = await api.get('/taxes/')
      const raw = Array.isArray(response.data) ? response.data : []
      setTaxes(
        raw.map((t: Tax) => ({
          ...t,
          description: t.description ?? '',
          rates: Array.isArray(t.rates) ? t.rates : [],
        }))
      )
    } catch (error: unknown) {
      if (isConnectionError(error)) {
        console.warn(`Backend not reachable (${getBackendOrigin()})`)
        setTaxes([])
        setLoading(false)
        return
      }
      const err = error as { response?: { status?: number } }
      if (err.response?.status === 401) {
        localStorage.removeItem('access_token')
        router.push('/login')
        toast.error('Session expired. Please sign in again.')
      } else {
        const msg = extractErrorMessage(error, 'Failed to load taxes')
        toast.error(msg)
        setTaxes([])
      }
    } finally {
      setLoading(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return taxes
    return taxes.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q)
    )
  }, [taxes, search])

  const resetForm = () => {
    setFormData({ name: '', description: '', is_active: true })
    setEditingId(null)
    setSelectedPreset('')
  }

  const applyPreset = (key: string) => {
    setSelectedPreset(key)
    if (!key) return
    const preset = BD_PRESETS[Number(key)]
    if (!preset) return
    setFormData({
      name: preset.name,
      description: preset.description,
      is_active: true,
    })
  }

  const openCreate = () => {
    resetForm()
    setShowModal(true)
  }

  const openEdit = (tax: Tax) => {
    setEditingId(tax.id)
    setFormData({
      name: tax.name,
      description: tax.description || '',
      is_active: tax.is_active,
    })
    setSelectedPreset('')
    setShowModal(true)
  }

  const submitTax = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = formData.name.trim()
    if (!name) {
      toast.error('Tax name is required')
      return
    }
    try {
      if (editingId) {
        await api.put(`/taxes/${editingId}/`, {
          name,
          description: formData.description.trim(),
          is_active: formData.is_active,
        })
        toast.success('Tax updated')
      } else {
        const { data: created } = await api.post('/taxes/', {
          name,
          description: formData.description.trim(),
          is_active: formData.is_active,
        })
        if (selectedPreset !== '' && created?.id) {
          const preset = BD_PRESETS[Number(selectedPreset)]
          if (preset?.defaultRate) {
            try {
              await api.post('/taxes/rates/', {
                tax_id: created.id,
                rate: parseFloat(preset.defaultRate),
                effective_from: new Date().toISOString().split('T')[0],
                effective_to: null,
              })
            } catch {
              /* rate optional */
            }
          }
        }
        toast.success('Tax created')
      }
      setShowModal(false)
      resetForm()
      await fetchTaxes()
    } catch (error: unknown) {
      toast.error(extractErrorMessage(error, editingId ? 'Failed to update tax' : 'Failed to create tax'))
    }
  }

  const deleteTax = async (tax: Tax) => {
    if (!confirm(`Delete tax “${tax.name}”? This cannot be undone.`)) return
    try {
      await api.delete(`/taxes/${tax.id}/`)
      toast.success('Tax deleted')
      await fetchTaxes()
    } catch (error: unknown) {
      toast.error(extractErrorMessage(error, 'Failed to delete tax'))
    }
  }

  const openAddRate = (taxId: number) => {
    setRateTargetTaxId(taxId)
    setRateForm({
      rate: '',
      effective_from: new Date().toISOString().split('T')[0],
      effective_to: '',
    })
    setShowRateModal(true)
  }

  const submitRate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!rateTargetTaxId) return
    const pct = parseFloat(rateForm.rate)
    if (Number.isNaN(pct) || pct < 0 || pct > 100) {
      toast.error('Rate must be between 0 and 100')
      return
    }
    try {
      await api.post('/taxes/rates/', {
        tax_id: rateTargetTaxId,
        rate: pct,
        effective_from: rateForm.effective_from || null,
        effective_to: rateForm.effective_to || null,
      })
      toast.success('Rate added')
      setShowRateModal(false)
      setRateTargetTaxId(null)
      await fetchTaxes()
    } catch (error: unknown) {
      toast.error(extractErrorMessage(error, 'Failed to add rate'))
    }
  }

  const deleteRate = async (rateId: number) => {
    if (!confirm('Delete this rate?')) return
    try {
      await api.delete(`/taxes/rates/${rateId}/`)
      toast.success('Rate removed')
      await fetchTaxes()
    } catch (error: unknown) {
      toast.error(extractErrorMessage(error, 'Failed to delete rate'))
    }
  }

  const initBangladesh = async () => {
    if (!confirm('Apply Bangladesh VAT default (15%) for this company if missing?')) return
    try {
      await api.post('/taxes/init-bangladesh/')
      toast.success('Bangladesh VAT defaults checked')
      await fetchTaxes()
    } catch (error: unknown) {
      toast.error(extractErrorMessage(error, 'Could not initialize defaults'))
    }
  }

  if (loading) {
    return (
      <PageLayout>
        <div className="flex min-h-[50vh] items-center justify-center">
          <div
            className="h-10 w-10 animate-spin rounded-full border-2 border-border border-t-blue-600"
            aria-label="Loading"
          />
        </div>
      </PageLayout>
    )
  }

  return (
    <PageLayout>
      <ErpPageShell
        showBackLink={false}
        title={pageMeta.title}
        titleIcon={Percent}
        description={pageMeta.description}
        maxWidthClass="max-w-[1600px]"
        contentClassName="mt-4"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fetchTaxes()}
              className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white backdrop-blur hover:bg-white/20"
            >
              <RefreshCw className="h-4 w-4 shrink-0" />
              Refresh
            </button>
            {canInitBangladesh && (
              <button
                type="button"
                onClick={initBangladesh}
                className="inline-flex items-center gap-2 rounded-full bg-emerald-400/90 px-4 py-2 text-sm font-semibold text-foreground hover:bg-emerald-300"
              >
                <Building2 className="h-4 w-4 shrink-0" />
                Bangladesh defaults
              </button>
            )}
            {canManageTax && (
              <button
                type="button"
                onClick={openCreate}
                className="erp-btn-cta"
              >
                <Plus className="h-4 w-4 shrink-0" />
                New tax
              </button>
            )}
          </div>
        }
      >
          {/* Info */}
          <div className="mb-6 rounded-xl border border-border/80 bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
            <div className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Percent className="h-4 w-4" />
              </div>
              <div className="min-w-0 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Bangladesh context — </span>
                VAT, supplementary duty (SD), and AIT are commonly used for fuel retail. Confirm percentages with
                current NBR rules before go-live. Badges below are inferred from the tax name for readability only.
              </div>
            </div>
          </div>

          {/* Toolbar */}
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative max-w-md flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
              <input
                type="search"
                placeholder="Search by name or description…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-sm shadow-sm placeholder:text-muted-foreground/70 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </div>
            <p className="text-sm text-muted-foreground">
              {filtered.length} of {taxes.length} shown
            </p>
          </div>

          {/* Table */}
          {filtered.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-border/80 bg-white shadow-sm ring-1 ring-slate-900/5">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border text-left text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-foreground/85">Tax</th>
                      <th className="hidden px-4 py-3 font-semibold text-foreground/85 md:table-cell">Kind</th>
                      <th className="px-4 py-3 font-semibold text-foreground/85">Rates</th>
                      <th className="hidden px-4 py-3 font-semibold text-foreground/85 lg:table-cell">Status</th>
                      {canManageTax && (
                        <th className="px-4 py-3 text-right font-semibold text-foreground/85">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/70">
                    {filtered.map((tax) => {
                      const kind = inferTaxKind(tax.name)
                      return (
                        <tr key={tax.id} className="transition hover:bg-muted/50">
                          <td className="px-4 py-3 align-top">
                            <div className="font-medium text-foreground">{tax.name}</div>
                            {tax.description ? (
                              <p className="mt-0.5 line-clamp-2 max-w-md text-xs text-muted-foreground">{tax.description}</p>
                            ) : null}
                            <span className="mt-1 inline-flex md:hidden">
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${kind.className}`}
                              >
                                {kind.label}
                              </span>
                            </span>
                          </td>
                          <td className="hidden align-top md:table-cell md:px-4 md:py-3">
                            <span
                              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${kind.className}`}
                            >
                              {kind.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 align-top">
                            {tax.rates.length === 0 ? (
                              <span className="text-xs italic text-muted-foreground/70">No rates yet</span>
                            ) : (
                              <ul className="space-y-1.5">
                                {tax.rates.map((r) => (
                                  <li
                                    key={r.id}
                                    className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm"
                                  >
                                    <span className="font-semibold tabular-nums text-primary">
                                      {formatNumber(Number(r.rate))}%
                                    </span>
                                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                                      <CalendarRange className="h-3.5 w-3.5 shrink-0" />
                                      {r.effective_from || '—'}
                                      {r.effective_to ? ` → ${r.effective_to}` : ''}
                                    </span>
                                    {canHardDelete && (
                                      <button
                                        type="button"
                                        onClick={() => deleteRate(r.id)}
                                        className="ml-1 rounded p-1 text-muted-foreground/70 transition hover:bg-destructive/5 hover:text-destructive"
                                        title="Delete rate"
                                        aria-label={`Delete rate ${r.rate}%`}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                          <td className="hidden align-top lg:table-cell lg:px-4 lg:py-3">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                tax.is_active
                                  ? 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/60'
                                  : 'bg-muted text-muted-foreground ring-1 ring-border/80'
                              }`}
                            >
                              {tax.is_active ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          {canManageTax && (
                            <td className="px-4 py-3 align-top">
                              <div className="flex flex-wrap items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => openEdit(tax)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm transition hover:border-primary/25 hover:bg-accent/80 hover:text-primary/80"
                                >
                                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openAddRate(tax.id)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-xs font-medium text-foreground shadow-sm transition hover:border-violet-200 hover:bg-violet-50/80 hover:text-violet-900"
                                >
                                  <Percent className="h-3.5 w-3.5" aria-hidden />
                                  Add rate
                                </button>
                                {canHardDelete && (
                                  <button
                                    type="button"
                                    onClick={() => deleteTax(tax)}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-100 bg-white px-2.5 py-1.5 text-xs font-medium text-destructive shadow-sm transition hover:bg-destructive/5"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                    Delete
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-white px-6 py-16 text-center shadow-sm">
              <FileText className="mx-auto h-12 w-12 text-muted-foreground/40" />
              <p className="mt-4 text-base font-medium text-foreground/85">No taxes match your search</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {taxes.length === 0
                  ? 'Create a tax or apply Bangladesh defaults to get started.'
                  : 'Try a different search term.'}
              </p>
              {taxes.length === 0 && canManageTax && (
                <div className="mt-6 flex flex-wrap justify-center gap-2">
                  {canInitBangladesh && (
                    <button
                      type="button"
                      onClick={initBangladesh}
                      className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
                    >
                      <Building2 className="h-4 w-4" />
                      Bangladesh defaults
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={openCreate}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary"
                  >
                    <Plus className="h-4 w-4" />
                    New tax
                  </button>
                </div>
              )}
            </div>
          )}
      {/* Tax modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 p-4 backdrop-blur-[1px]">
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10"
            role="dialog"
            aria-labelledby="tax-modal-title"
          >
            <div className="flex items-center justify-between border-b border-border/70 px-6 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-white">
                  <Percent className="h-4 w-4" />
                </div>
                <h2 id="tax-modal-title" className="text-lg font-semibold text-foreground">
                  {editingId ? 'Edit tax' : 'New tax'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowModal(false)
                  resetForm()
                }}
                className="rounded-lg p-2 text-muted-foreground/70 hover:bg-muted hover:text-foreground/85"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={submitTax} className="space-y-5 px-6 py-5">
              {!editingId && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground/85">Quick preset (optional)</label>
                  <select
                    value={selectedPreset}
                    onChange={(e) => applyPreset(e.target.value)}
                    className="w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-ring/20"
                  >
                    <option value="">— Custom —</option>
                    {BD_PRESETS.map((p, i) => (
                      <option key={p.name} value={String(i)}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">Fills name and description; optional default rate after create.</p>
                </div>
              )}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground/85">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  value={formData.name}
                  onChange={(e) => {
                    setFormData({ ...formData, name: e.target.value })
                    setSelectedPreset('')
                  }}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-ring/20"
                  placeholder="e.g. VAT"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground/85">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => {
                    setFormData({ ...formData, description: e.target.value })
                    setSelectedPreset('')
                  }}
                  rows={3}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-ring/20"
                  placeholder="Notes for your team (optional)"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground/85">
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-ring"
                />
                Active
              </label>
              <div className="flex justify-end gap-2 border-t border-border/70 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    resetForm()
                  }}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-foreground/85 hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary"
                >
                  {editingId ? 'Save changes' : 'Create tax'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rate modal */}
      {showRateModal && rateTargetTaxId != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 p-4 backdrop-blur-[1px]">
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-900/10"
            role="dialog"
            aria-labelledby="rate-modal-title"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 id="rate-modal-title" className="text-lg font-semibold text-foreground">
                Add rate
              </h2>
              <button
                type="button"
                onClick={() => {
                  setShowRateModal(false)
                  setRateTargetTaxId(null)
                }}
                className="rounded-lg p-2 text-muted-foreground/70 hover:bg-muted"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={submitRate} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-foreground/85">
                  Rate (%) <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  type="number"
                  step="0.01"
                  min={0}
                  max={100}
                  value={rateForm.rate}
                  onChange={(e) => setRateForm({ ...rateForm, rate: e.target.value })}
                  className="w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-ring/20"
                  placeholder="15.00"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground/85">Effective from</label>
                  <CompanyDateInput value={rateForm.effective_from} onChange={(iso) => setRateForm({ ...rateForm, effective_from: iso })} className="w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-ring/20" />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-foreground/85">Effective to</label>
                  <CompanyDateInput value={rateForm.effective_to} onChange={(iso) => setRateForm({ ...rateForm, effective_to: iso })} className="w-full rounded-lg border border-border px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-ring/20" />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Leave dates empty if your deployment does not require schedule boundaries.</p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowRateModal(false)
                    setRateTargetTaxId(null)
                  }}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-foreground/85 hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary"
                >
                  Add rate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      </ErpPageShell>
    </PageLayout>
  )
}
