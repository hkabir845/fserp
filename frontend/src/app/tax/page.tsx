'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
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
    return { label: 'VAT', className: 'bg-blue-100 text-blue-800 ring-1 ring-blue-200/60' }
  }
  if (n.includes('SUPPLEMENTARY') || /\bSD\b/.test(n) || n.includes('PETROL') || n.includes('DIESEL')) {
    return { label: 'SD', className: 'bg-violet-100 text-violet-800 ring-1 ring-violet-200/60' }
  }
  if (n.includes('AIT') || n.includes('ADVANCE INCOME')) {
    return { label: 'AIT', className: 'bg-amber-100 text-amber-900 ring-1 ring-amber-200/60' }
  }
  return { label: 'Tax', className: 'bg-slate-100 text-slate-700 ring-1 ring-slate-200/60' }
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
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div
          className="h-10 w-10 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600"
          aria-label="Loading"
        />
      </div>
    )
  }

  return (
    <div className="flex h-screen bg-slate-50 page-with-sidebar">
      <Sidebar />
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
                Tax management
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                Configure tax names, rates, and effective dates. One deployment — changes apply to this company
                only.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fetchTaxes()}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                <RefreshCw className="h-4 w-4 shrink-0" />
                Refresh
              </button>
              {canInitBangladesh && (
                <button
                  type="button"
                  onClick={initBangladesh}
                  className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 shadow-sm transition hover:bg-emerald-100"
                >
                  <Building2 className="h-4 w-4 shrink-0" />
                  Bangladesh defaults
                </button>
              )}
              {canManageTax && (
                <button
                  type="button"
                  onClick={openCreate}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                >
                  <Plus className="h-4 w-4 shrink-0" />
                  New tax
                </button>
              )}
            </div>
          </div>

          {/* Info */}
          <div className="mb-6 rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm ring-1 ring-slate-900/5">
            <div className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                <Percent className="h-4 w-4" />
              </div>
              <div className="min-w-0 text-sm text-slate-600">
                <span className="font-medium text-slate-800">Bangladesh context — </span>
                VAT, supplementary duty (SD), and AIT are commonly used for fuel retail. Confirm percentages with
                current NBR rules before go-live. Badges below are inferred from the tax name for readability only.
              </div>
            </div>
          </div>

          {/* Toolbar */}
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative max-w-md flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                placeholder="Search by name or description…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
            <p className="text-sm text-slate-500">
              {filtered.length} of {taxes.length} shown
            </p>
          </div>

          {/* Table */}
          {filtered.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm ring-1 ring-slate-900/5">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                  <thead className="bg-slate-50/90">
                    <tr>
                      <th className="px-4 py-3 font-semibold text-slate-700">Tax</th>
                      <th className="hidden px-4 py-3 font-semibold text-slate-700 md:table-cell">Kind</th>
                      <th className="px-4 py-3 font-semibold text-slate-700">Rates</th>
                      <th className="hidden px-4 py-3 font-semibold text-slate-700 lg:table-cell">Status</th>
                      {canManageTax && (
                        <th className="px-4 py-3 text-right font-semibold text-slate-700">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((tax) => {
                      const kind = inferTaxKind(tax.name)
                      return (
                        <tr key={tax.id} className="transition hover:bg-slate-50/80">
                          <td className="px-4 py-3 align-top">
                            <div className="font-medium text-slate-900">{tax.name}</div>
                            {tax.description ? (
                              <p className="mt-0.5 line-clamp-2 max-w-md text-xs text-slate-500">{tax.description}</p>
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
                              <span className="text-xs italic text-slate-400">No rates yet</span>
                            ) : (
                              <ul className="space-y-1.5">
                                {tax.rates.map((r) => (
                                  <li
                                    key={r.id}
                                    className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm"
                                  >
                                    <span className="font-semibold tabular-nums text-blue-700">
                                      {Number(r.rate).toFixed(2)}%
                                    </span>
                                    <span className="inline-flex items-center gap-1 text-slate-500">
                                      <CalendarRange className="h-3.5 w-3.5 shrink-0" />
                                      {r.effective_from || '—'}
                                      {r.effective_to ? ` → ${r.effective_to}` : ''}
                                    </span>
                                    {canHardDelete && (
                                      <button
                                        type="button"
                                        onClick={() => deleteRate(r.id)}
                                        className="ml-1 rounded p-1 text-slate-400 transition hover:bg-red-50 hover:text-red-600"
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
                                  : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/80'
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
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 shadow-sm transition hover:border-blue-200 hover:bg-blue-50/80 hover:text-blue-800"
                                >
                                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openAddRate(tax.id)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 shadow-sm transition hover:border-violet-200 hover:bg-violet-50/80 hover:text-violet-900"
                                >
                                  <Percent className="h-3.5 w-3.5" aria-hidden />
                                  Add rate
                                </button>
                                {canHardDelete && (
                                  <button
                                    type="button"
                                    onClick={() => deleteTax(tax)}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-100 bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 shadow-sm transition hover:bg-red-50"
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
            <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
              <FileText className="mx-auto h-12 w-12 text-slate-300" />
              <p className="mt-4 text-base font-medium text-slate-700">No taxes match your search</p>
              <p className="mt-1 text-sm text-slate-500">
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
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
                  >
                    <Plus className="h-4 w-4" />
                    New tax
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tax modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[1px]">
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/10"
            role="dialog"
            aria-labelledby="tax-modal-title"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white">
                  <Percent className="h-4 w-4" />
                </div>
                <h2 id="tax-modal-title" className="text-lg font-semibold text-slate-900">
                  {editingId ? 'Edit tax' : 'New tax'}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowModal(false)
                  resetForm()
                }}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={submitTax} className="space-y-5 px-6 py-5">
              {!editingId && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Quick preset (optional)</label>
                  <select
                    value={selectedPreset}
                    onChange={(e) => applyPreset(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="">— Custom —</option>
                    {BD_PRESETS.map((p, i) => (
                      <option key={p.name} value={String(i)}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-slate-500">Fills name and description; optional default rate after create.</p>
                </div>
              )}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Name <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  value={formData.name}
                  onChange={(e) => {
                    setFormData({ ...formData, name: e.target.value })
                    setSelectedPreset('')
                  }}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="e.g. VAT"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => {
                    setFormData({ ...formData, description: e.target.value })
                    setSelectedPreset('')
                  }}
                  rows={3}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="Notes for your team (optional)"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                Active
              </label>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowModal(false)
                    resetForm()
                  }}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-[1px]">
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-900/10"
            role="dialog"
            aria-labelledby="rate-modal-title"
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 id="rate-modal-title" className="text-lg font-semibold text-slate-900">
                Add rate
              </h2>
              <button
                type="button"
                onClick={() => {
                  setShowRateModal(false)
                  setRateTargetTaxId(null)
                }}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={submitRate} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
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
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="15.00"
                />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Effective from</label>
                  <input
                    type="date"
                    value={rateForm.effective_from}
                    onChange={(e) => setRateForm({ ...rateForm, effective_from: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Effective to</label>
                  <input
                    type="date"
                    value={rateForm.effective_to}
                    onChange={(e) => setRateForm({ ...rateForm, effective_to: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>
              <p className="text-xs text-slate-500">Leave dates empty if your deployment does not require schedule boundaries.</p>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowRateModal(false)
                    setRateTargetTaxId(null)
                  }}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                >
                  Add rate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
