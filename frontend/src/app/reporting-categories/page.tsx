'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Sidebar from '@/components/Sidebar'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { useToast } from '@/components/Toast'
import api from '@/lib/api'
import { extractErrorMessage } from '@/utils/errorHandler'

type Application = 'aquaculture' | 'fuel_station'
type Kind = 'expense' | 'income'

interface MapTarget {
  id: string
  label: string
}

interface CategoryRow {
  id: number
  application: Application
  kind: Kind
  code: string
  label: string
  maps_to_code: string
  is_active: boolean
  sort_order: number
}

function parseUser(): { isAdmin: boolean } {
  try {
    const raw = localStorage.getItem('user')
    if (!raw) return { isAdmin: false }
    const u = JSON.parse(raw) as { role?: string; company_id?: number; permissions?: string[] }
    const r = (u.role || '').toLowerCase()
    if (r === 'super_admin') return { isAdmin: true }
    if (r === 'admin' && u.company_id) return { isAdmin: true }
    if (Array.isArray(u.permissions) && (u.permissions.includes('*') || u.permissions.includes('app.settings')))
      return { isAdmin: true }
  } catch {
    /* ignore */
  }
  return { isAdmin: false }
}

export default function ReportingCategoriesPage() {
  const router = useRouter()
  const toast = useToast()
  const { isAdmin } = useMemo(() => parseUser(), [])
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<CategoryRow[]>([])
  const [mapTargets, setMapTargets] = useState<MapTarget[]>([])
  const [application, setApplication] = useState<Application>('aquaculture')
  const [kind, setKind] = useState<Kind>('expense')
  const [form, setForm] = useState({
    code: '',
    label: '',
    maps_to_code: '',
    sort_order: '0',
  })

  const loadTargets = useCallback(async () => {
    try {
      const { data } = await api.get<{ map_targets: MapTarget[] }>('/reporting-categories/map-targets/', {
        params: { application, kind },
      })
      setMapTargets(Array.isArray(data?.map_targets) ? data.map_targets : [])
    } catch {
      setMapTargets([])
    }
  }, [application, kind])

  const loadRows = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get<CategoryRow[]>('/reporting-categories/', {
        params: { application, kind },
      })
      setRows(Array.isArray(data) ? data : [])
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Could not load categories'))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [application, kind, toast])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      router.push('/login')
      return
    }
    if (!isAdmin) {
      setLoading(false)
      return
    }
    void loadTargets()
  }, [isAdmin, loadTargets, router])

  useEffect(() => {
    if (!isAdmin) return
    void loadRows()
  }, [isAdmin, loadRows])

  useEffect(() => {
    if (!isAdmin) return
    void loadTargets()
  }, [isAdmin, loadTargets])

  const onCreate = async () => {
    if (!form.code.trim() || !form.label.trim() || !form.maps_to_code) {
      toast.error('Code, label, and rollup (maps to) are required.')
      return
    }
    try {
      await api.post('/reporting-categories/', {
        application,
        kind,
        code: form.code.trim(),
        label: form.label.trim(),
        maps_to_code: form.maps_to_code,
        sort_order: Number(form.sort_order) || 0,
        is_active: true,
      })
      toast.success('Category created')
      setForm({ code: '', label: '', maps_to_code: '', sort_order: '0' })
      await loadRows()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Create failed'))
    }
  }

  const onDelete = async (id: number) => {
    if (!window.confirm('Delete this company-defined category?')) return
    try {
      await api.delete(`/reporting-categories/${id}/`)
      toast.success('Deleted')
      await loadRows()
    } catch (e) {
      toast.error(extractErrorMessage(e, 'Delete failed'))
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen bg-slate-50">
        <Sidebar />
        <main className="flex-1 p-6">
          <h1 className="text-xl font-semibold text-slate-800">Reporting categories</h1>
          <p className="mt-2 text-slate-600">Only company administrators can manage reporting categories.</p>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-2xl font-semibold text-slate-900">Reporting categories</h1>
          <p className="mt-2 text-sm text-slate-600">
            Add company-specific income and expense labels for Aquaculture (pond P&amp;L, sales, and GL rollups) and
            Fuel station (optional tags on manual journal lines). Each custom code maps to a built-in rollup so
            accounting rules stay consistent.
          </p>

          <div className="mt-6 flex flex-wrap gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <label className="flex flex-col text-xs font-medium text-slate-600">
              Application
              <select
                className="mt-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={application}
                onChange={(e) => setApplication(e.target.value as Application)}
              >
                <option value="aquaculture">Aquaculture</option>
                <option value="fuel_station">Fuel station</option>
              </select>
            </label>
            <label className="flex flex-col text-xs font-medium text-slate-600">
              Kind
              <select
                className="mt-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
                value={kind}
                onChange={(e) => setKind(e.target.value as Kind)}
              >
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
            </label>
          </div>

          <section className="mt-6 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-lg font-medium text-slate-800">Add category</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col text-xs font-medium text-slate-600">
                Code (lowercase, e.g. site_security)
                <input
                  className="mt-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                />
              </label>
              <label className="flex flex-col text-xs font-medium text-slate-600">
                Label (shown in pickers)
                <input
                  className="mt-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                />
              </label>
              <label className="flex flex-col text-xs font-medium text-slate-600 sm:col-span-2">
                Rolls up to (built-in aquaculture type or fuel-station rollup)
                <select
                  className="mt-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
                  value={form.maps_to_code}
                  onChange={(e) => setForm((f) => ({ ...f, maps_to_code: e.target.value }))}
                >
                  <option value="">— select —</option>
                  {mapTargets.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} ({m.id})
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col text-xs font-medium text-slate-600">
                Sort order
                <input
                  className="mt-1 rounded border border-slate-300 px-2 py-1.5 text-sm"
                  value={form.sort_order}
                  onChange={(e) => setForm((f) => ({ ...f, sort_order: e.target.value }))}
                />
              </label>
            </div>
            <button
              type="button"
              className="mt-4 inline-flex items-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              onClick={() => void onCreate()}
            >
              <Plus className="h-4 w-4" />
              Create
            </button>
          </section>

          <section className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-lg font-medium text-slate-800">Existing ({application} · {kind})</h2>
            </div>
            {loading ? (
              <div className="flex items-center gap-2 p-6 text-slate-600">
                <Loader2 className="h-5 w-5 animate-spin" />
                Loading…
              </div>
            ) : rows.length === 0 ? (
              <p className="p-6 text-sm text-slate-600">No company-defined categories for this filter.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <div>
                      <span className="font-mono font-medium text-slate-900">{r.code}</span>
                      <span className="text-slate-600"> — {r.label}</span>
                      <div className="text-xs text-slate-500">
                        maps to <span className="font-mono">{r.maps_to_code}</span>
                        {r.sort_order !== 0 ? ` · order ${r.sort_order}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                      onClick={() => void onDelete(r.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="mt-6 text-xs text-slate-500">
            Aquaculture: use these codes in pond expenses and fish sales. Fuel station: pick a tag when entering manual
            journal lines (both debit and credit lines created from the same row share the tag).
          </p>
        </div>
      </main>
    </div>
  )
}
